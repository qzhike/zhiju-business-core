import { MockControls } from './control-slot.js';
// DEVELOPMENT_TASK_WORKSPACE_ADAPTER_ONLY: task-driven M1 rehearsal workspace.
// It reuses the in-memory U1/U2/U3 fixtures and never calls Core or Runner.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Missing } from '../shell.js';
import { JourneyNav } from '../mvp/JourneyNav.js';
import {
  activeSubmission,
  sameVersionSet,
  viewedVersionSet,
  type FileVersionRef,
  type MvpStageId,
  type StageFinalization,
} from '../mvp/review-model.js';
import { planActionLabels, planLevelLabels, type PlanFile, type PlanView } from '../plan/model.js';
import { inputEntryLabels } from '../intake/model.js';
import { u1Project, u1ReportOne, u1ReportTwo } from './u1-data.js';
import { useU1 } from './u1.js';
import {
  emptySession,
  planStageFiles,
  sessionKey,
  useU2,
  type GenerationAttempt,
  type StageSession,
} from './u2.js';
import { useU3, type U3DeliveryApi } from './u3.js';
import { useResults } from './results.js';
import { u2VersionLabel } from './u2-data.js';
import './task-workspace.css';

const projectId = u1Project.id;
const base = `/projects/${projectId}`;
const workPath = `${base}/work`;
const stages: readonly MvpStageId[] = ['MANUAL', 'PROCEDURES', 'RULES'];
type StageNumber = 1 | 2 | 3;

function stageNumber(stage: MvpStageId): StageNumber {
  return stage === 'MANUAL' ? 1 : stage === 'PROCEDURES' ? 2 : 3;
}

function stageFiles(plan: PlanView, stage: MvpStageId): PlanFile[] {
  return planStageFiles(plan, stage);
}

function stageSession(u2: ReturnType<typeof useU2>, plan: PlanView, stage: MvpStageId) {
  const key = sessionKey(plan, stage);
  return u2.sessions[key] ?? emptySession(key, stage);
}

function stageRoundId(plan: PlanView, stage: MvpStageId, versionId: string): string {
  return `${stage}-${versionId}@${plan.planId}-v${plan.version}`;
}

function stageRoundLabel(plan: PlanView, stage: MvpStageId, versionId: string): string {
  return `${mvpStageLabel(stage)} · ${u2VersionLabel(versionId)} · ${plan.planId} 第 ${plan.version} 版`;
}

function mvpStageLabel(stage: MvpStageId): string {
  return stage === 'MANUAL'
    ? '质量手册'
    : stage === 'PROCEDURES'
      ? '控制程序'
      : '管理制度及记录表单';
}

function stageOfLevel(level: PlanFile['level']): MvpStageId {
  return level === 'MANUAL' ? 'MANUAL' : level === 'PROCEDURE' ? 'PROCEDURES' : 'RULES';
}

function stageOfPath(path: string): MvpStageId | undefined {
  if (path.includes('质量手册')) return 'MANUAL';
  if (path.includes('程序文件')) return 'PROCEDURES';
  if (path.includes('管理制度')) return 'RULES';
  if (path.includes('记录表单')) return 'RULES';
  if (path.includes('外来文件')) return 'RULES';
  return undefined;
}

function viewedSet(plan: PlanView, stage: MvpStageId, session: StageSession): FileVersionRef[] {
  const availabilities = stageFiles(plan, stage).map((file) => ({
    fileId: file.id,
    versionId: session.files[file.id]?.viewedVersionId ?? '',
    versions: session.files[file.id]?.versions ?? [],
    viewedVersionId: session.files[file.id]?.viewedVersionId,
  }));
  return viewedVersionSet(availabilities) ?? [];
}

function commonVersion(
  plan: PlanView,
  stage: MvpStageId,
  session: StageSession,
): string | undefined {
  const values = stageFiles(plan, stage)
    .map((file) => session.files[file.id]?.viewedVersionId)
    .filter((value): value is string => value !== undefined);
  if (values.length === 0) return undefined;
  return values.every((value) => value === values[0]) ? values[0] : values[0];
}

function latestVersion(session: StageSession, fileId: string): string | undefined {
  return session.files[fileId]?.versions.at(-1);
}

function fileDetailHref(roundId: string, fileId: string): string {
  return `${base}/results/${encodeURIComponent(roundId)}/${encodeURIComponent(fileId)}`;
}

function opinionKey(roundId: string, fileId: string, versionId: string): string {
  return `${roundId}:${fileId}:${versionId}`;
}

function versionForFile(session: StageSession, fileId: string): string | undefined {
  return session.files[fileId]?.viewedVersionId;
}

function upstreamChanged(
  stage: MvpStageId,
  finalization: StageFinalization | undefined,
  manual: StageFinalization | undefined,
  procedure: StageFinalization | undefined,
): boolean {
  if (!finalization) return false;
  if (stage === 'PROCEDURES') return finalization.manualFinalizationId !== manual?.finalizationId;
  if (stage === 'RULES')
    return (
      finalization.manualFinalizationId !== manual?.finalizationId ||
      finalization.procedureFinalizationId !== procedure?.finalizationId
    );
  return false;
}

function newerThanFinalization(
  plan: PlanView,
  stage: MvpStageId,
  session: StageSession,
  finalization: StageFinalization | undefined,
): boolean {
  if (!finalization) return false;
  return stageFiles(plan, stage).some((file) => {
    const latest = latestVersion(session, file.id);
    if (!latest) return false;
    return !finalization.files.some((ref) => ref.fileId === file.id && ref.versionId === latest);
  });
}

export interface StageInfo {
  stage: MvpStageId;
  session: StageSession;
  ready: { ready: boolean; reason?: string | undefined };
  files: readonly PlanFile[];
  viewed: readonly FileVersionRef[];
  versionId?: string | undefined;
  roundId: string;
  hasCandidate: boolean;
  unviewed: boolean;
  finalization?: StageFinalization | undefined;
  upstreamChanged: boolean;
  newerThanFinal: boolean;
  submitted: boolean;
  roundSaved: readonly [string, { text: string; label: string }][];
  lastUnresolved?: GenerationAttempt | undefined;
}

export type TaskKey =
  | 'START_ANALYSIS'
  | 'CLARIFY'
  | 'SCOPE'
  | 'PLAN_RECONCILE'
  | 'PLAN_RETRY'
  | 'GENERATE'
  | 'GEN_RECOVERY'
  | 'VIEW_NEW'
  | 'REVIEW'
  | 'SUBMIT'
  | 'REFINALIZE'
  | 'RECOVERY'
  | 'DELIVERY_CONFIRM'
  | 'DELIVERY_RECONCILE'
  | 'PACKAGING'
  | 'PACKAGING_RECOVERY'
  | 'DOWNLOAD';

export interface TaskState {
  key: TaskKey;
  stage?: MvpStageId | undefined;
  title: string;
  reason: string;
}

function useProjectModel() {
  const u1 = useU1();
  const u2 = useU2();
  const u3 = useU3();
  const results = useResults();
  const plan = u2.plan;
  const active = activeSubmission(
    Object.values(u2.sessions).flatMap((session) => session.submissions),
  );
  const infos: StageInfo[] = stages.map((stage) => {
    const session = stageSession(u2, plan, stage);
    const files = stageFiles(plan, stage);
    const versionId = commonVersion(plan, stage, session);
    const viewed = viewedSet(plan, stage, session);
    const roundId = versionId ? stageRoundId(plan, stage, versionId) : '';
    const finalization = session.finalization;
    const hasCandidate = files.some((file) => (session.files[file.id]?.versions.length ?? 0) > 0);
    const unviewed = files.some((file) => {
      const state = session.files[file.id];
      const latest = state?.versions.at(-1);
      return latest !== undefined && latest !== state?.viewedVersionId;
    });
    const finalizationNow = finalization;
    const submitted = session.submissions.some(
      (submission) =>
        submission.status === 'RECEIVED' &&
        viewed.length > 0 &&
        sameVersionSet(submission.basis.files, viewed),
    );
    return {
      stage,
      session,
      ready: u2.stageReady[stage],
      files,
      viewed,
      versionId,
      roundId,
      hasCandidate,
      unviewed,
      finalization: finalizationNow,
      upstreamChanged: upstreamChanged(
        stage,
        finalizationNow,
        u2.manualFinalization,
        u2.procedureFinalization,
      ),
      newerThanFinal: newerThanFinalization(plan, stage, session, finalizationNow),
      submitted,
      roundSaved: roundId
        ? Object.entries(results.saved).filter(([key]) => key.startsWith(`${roundId}:`))
        : [],
      lastUnresolved: session.generationAttempts
        .filter((attempt) => attempt.unresolvedHistory)
        .at(-1),
    };
  });
  const allFinal = infos.every(
    (info) => info.finalization && !info.upstreamChanged && !info.newerThanFinal,
  );
  const delivery = u3.deliveryApi;
  const recovery = u3.recovery;
  const task = deriveTask(u1, u2, plan, infos, allFinal, delivery, recovery);
  return { u1, u2, u3, results, plan, infos, active, allFinal, delivery, recovery, task };
}

function deriveTask(
  u1: ReturnType<typeof useU1>,
  u2: ReturnType<typeof useU2>,
  plan: PlanView,
  infos: readonly StageInfo[],
  allFinal: boolean,
  delivery: U3DeliveryApi,
  recovery: ReturnType<typeof useU3>['recovery'],
): TaskState {
  if (!u1.analysisStarted)
    return {
      key: 'START_ANALYSIS',
      title: '开始分析资料',
      reason: '首轮合成资料已接收。开始整体分析后，再按实际发现决定是否需要澄清。',
    };
  if (!u1.analysisReady)
    return {
      key: 'CLARIFY',
      title: '需要你回答资料问题',
      reason:
        u1.clarificationMode === 'NONE'
          ? '本轮分析没有必须答复的事项。'
          : '分析发现 2 个需要客户确认的信息问题；答复后继续分析。',
    };
  if (plan.state === 'FAILED')
    return {
      key: 'PLAN_RETRY',
      title: '重新确认修改范围',
      reason: '上一次范围确认失败；原计划与依据保留，可重新发起一次确认。',
    };
  if (plan.state === 'PENDING' || plan.state === 'UNKNOWN')
    return {
      key: 'PLAN_RECONCILE',
      title: '核对原范围确认请求',
      reason: '范围确认结果尚未确定；只能核对原请求，不能重复生成。',
    };
  if (!u2.planCheck.ready)
    return {
      key: 'SCOPE',
      title: '确认修改范围',
      reason: '核对拟修订、新增与保留文件，以及输入依据和影响；确认后再生成质量手册初稿。',
    };
  if (recovery.active)
    return {
      key: 'RECOVERY',
      title: recovery.canQuery ? '核对原重试请求' : '重试已知失败文件',
      reason: recovery.note,
    };
  for (const info of infos) {
    const label = mvpStageLabel(info.stage);
    if (!info.ready.ready) break;
    if (!info.hasCandidate && !info.finalization) {
      if (info.lastUnresolved) {
        return {
          key: 'GEN_RECOVERY',
          stage: info.stage,
          title:
            info.lastUnresolved.status === 'FAILED'
              ? `${label}生成失败，需重试`
              : `${label}${info.lastUnresolved.status === 'UNKNOWN' ? '结果待核验' : '请求待核对'}`,
          reason: info.lastUnresolved.message,
        };
      }
      return {
        key: 'GENERATE',
        stage: info.stage,
        title: `生成${label}初稿`,
        reason: `当前阶段尚无候选；生成后在本工作区审阅、记录意见并确认完整集合。`,
      };
    }
    if (info.unviewed) {
      const latest = info.files
        .map((file) => latestVersion(info.session, file.id))
        .filter((value): value is string => value !== undefined);
      return {
        key: 'VIEW_NEW',
        stage: info.stage,
        title: `${label}有新稿可查看`,
        reason: `新稿 ${latest.map((version) => u2VersionLabel(version)).join('、')} 已到达；当前阅读保持不变，需显式查看后再核对。`,
      };
    }
    if (info.finalization) {
      if (info.upstreamChanged || info.newerThanFinal)
        return {
          key: 'REFINALIZE',
          stage: info.stage,
          title:
            info.upstreamChanged && info.stage !== 'MANUAL'
              ? `${label}依据已变化，需复核`
              : `${label}有后续改稿，需重新核对定稿`,
          reason: info.upstreamChanged
            ? '上游重新定稿后，本阶段旧集合仍保留但需按当前依据重新确认完整集合。'
            : '本阶段已有后续候选；旧定稿仍保留，需核对当前完整集合后重新定稿。',
        };
      continue;
    }
    if (info.roundSaved.length > 0 && !info.submitted)
      return {
        key: 'SUBMIT',
        stage: info.stage,
        title: '本轮意见待提交',
        reason: `本轮已保留 ${info.roundSaved.length} 条意见；核对汇总后提交一个修改意图并生成下一稿。`,
      };
    return {
      key: 'REVIEW',
      stage: info.stage,
      title: `审阅本轮${label}`,
      reason: '核对本轮文件、改动和待处理事项；记录意见后提交下一稿，或在完整集合上显式定稿。',
    };
  }
  if (!allFinal)
    return {
      key: 'REVIEW',
      title: '核对当前阶段',
      reason: '当前阶段尚未形成可确认的完整集合；请按阶段状态处理。',
    };
  if (
    delivery.state.packagingFrozen &&
    (delivery.state.packagingStatus === 'PENDING' ||
      delivery.state.packagingStatus === 'UNKNOWN' ||
      delivery.state.packagingStatus === 'MISMATCH' ||
      delivery.state.packagingStatus === 'FAILED')
  )
    return {
      key: 'PACKAGING_RECOVERY',
      title:
        delivery.state.packagingStatus === 'FAILED'
          ? '打包失败，需重试同一清单'
          : delivery.state.packagingStatus === 'PENDING'
            ? '正在打包冻结清单'
            : '核对原打包请求',
      reason: delivery.state.packagingNote,
    };
  if (!delivery.state.frozen) {
    if (
      delivery.state.confirmStatus === 'PENDING' ||
      delivery.state.confirmStatus === 'UNKNOWN' ||
      delivery.state.confirmStatus === 'MISMATCH'
    )
      return {
        key: 'DELIVERY_RECONCILE',
        title: '核对原最终确认请求',
        reason: delivery.state.confirmNote,
      };
    return {
      key: 'DELIVERY_CONFIRM',
      title: '核对最终交付清单',
      reason:
        delivery.blockers.length > 0
          ? `当前仍有未解决阻断：${delivery.blockers.join(' ')}`
          : '三个阶段均已定稿；核对完整文件与精确版本后确认清单并生成文档包。',
    };
  }
  if (delivery.state.packageAvailable)
    return {
      key: 'DOWNLOAD',
      title: '文档包已生成（模拟）',
      reason: '当前冻结清单对应的包可用；可下载并查看历史交付包。',
    };
  if (
    delivery.state.packagingStatus === 'UNKNOWN' ||
    delivery.state.packagingStatus === 'MISMATCH' ||
    delivery.state.packagingStatus === 'PENDING'
  )
    return {
      key: 'PACKAGING_RECOVERY',
      title: '打包结果待核对',
      reason: delivery.state.packagingNote,
    };
  if (delivery.state.packagingStatus === 'FAILED')
    return {
      key: 'PACKAGING_RECOVERY',
      title: '打包失败，需重试同一清单',
      reason: delivery.state.packagingNote,
    };
  return {
    key: 'PACKAGING',
    title: '打包已冻结清单',
    reason: '清单已冻结；可对同一清单生成文档包，不需要再次确认或重新生成文件。',
  };
}

function StepProgress({ infos, task }: { infos: readonly StageInfo[]; task: TaskState }) {
  const currentIndex = task.stage
    ? stages.indexOf(task.stage)
    : task.key === 'DELIVERY_CONFIRM' ||
        task.key === 'DELIVERY_RECONCILE' ||
        task.key === 'PACKAGING' ||
        task.key === 'PACKAGING_RECOVERY' ||
        task.key === 'DOWNLOAD'
      ? stages.length - 1
      : -1;
  return (
    <section className="panel task-progress" aria-label="三个业务阶段当前进度">
      <h2>三个业务阶段</h2>
      <ol className="task-steps">
        {infos.map((info, index) => {
          const state = info.upstreamChanged
            ? 'ATTENTION'
            : info.finalization && !info.newerThanFinal
              ? 'COMPLETE'
              : info.hasCandidate
                ? 'CURRENT'
                : info.ready.ready
                  ? 'UPCOMING'
                  : 'UPCOMING';
          return (
            <li
              key={info.stage}
              data-state={state}
              aria-current={index === currentIndex ? 'step' : undefined}
            >
              <span className="task-step-number" aria-hidden="true">
                {stageNumber(info.stage)}
              </span>
              <div>
                <strong>{mvpStageLabel(info.stage)}</strong>
                <span className="status-tag">
                  {info.upstreamChanged
                    ? '依据已变化，待复核'
                    : info.finalization && !info.newerThanFinal
                      ? '已定稿（模拟）'
                      : info.finalization
                        ? '有后续改稿'
                        : info.hasCandidate
                          ? '待审阅（演示）'
                          : info.ready.ready
                            ? '待生成候选'
                            : '等待前置'}
                </span>
                {info.finalization && <small>{info.finalization.finalizationId}</small>}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="muted" role="status">
        {currentIndex >= 0
          ? `当前进度：第 ${currentIndex + 1} 步 · ${mvpStageLabel(stages[currentIndex] ?? 'MANUAL')}`
          : task.key === 'START_ANALYSIS' || task.key === 'CLARIFY' || task.key === 'SCOPE'
            ? '当前进度：准备与整体分析；三个修订阶段尚未开始。'
            : '当前进度：等待范围确认。'}
      </p>
    </section>
  );
}

function PrimaryAction({ task, onRun }: { task: TaskState; onRun: () => void }) {
  const label: Record<TaskKey, string> = {
    START_ANALYSIS: '开始分析资料',
    CLARIFY: '提交答复并继续分析',
    SCOPE: '确认范围并生成质量手册初稿',
    PLAN_RECONCILE: '核对原确认请求',
    PLAN_RETRY: '重新确认修改范围',
    GENERATE: `生成${task.stage ? mvpStageLabel(task.stage) : '本阶段'}初稿`,
    GEN_RECOVERY: '核对或重试本阶段生成',
    VIEW_NEW: '查看新稿',
    REVIEW: '继续审阅本轮文件',
    SUBMIT: '核对并提交本轮意见',
    REFINALIZE: '核对并重新定稿',
    RECOVERY: '核对或重试恢复请求',
    DELIVERY_CONFIRM: '确认交付清单并生成文档包',
    DELIVERY_RECONCILE: '核对原最终确认请求',
    PACKAGING: '打包已冻结清单',
    PACKAGING_RECOVERY: '核对或重试打包',
    DOWNLOAD: '下载当前文档包',
  };
  return (
    <button className="button primary" onClick={onRun}>
      {label[task.key]}
    </button>
  );
}

function AnalysisPanel({
  model,
  answers,
  setAnswers,
  feedback,
}: {
  model: ReturnType<typeof useProjectModel>;
  answers: string;
  setAnswers: (value: string) => void;
  feedback: string;
}) {
  const { u1, plan } = model;
  const entries = u1.batches.flatMap((batch) => batch.entries);
  const containers = entries.filter((entry) => entry.format === 'RAR').length;
  const uploaded = entries.length - containers;
  const questions = u1ReportOne.attentionItems.filter(
    (item) => item.kind === 'FACT_QUESTION' && item.audience === 'CUSTOMER',
  );
  return (
    <section className="panel task-analysis" aria-label="分析与范围">
      <h2>资料与分析</h2>
      <p className="muted">
        首轮 {u1.batches.length > 0 ? u1.batches.length : 0} 批 · 上传成员 {uploaded} · 容器{' '}
        {containers} · 读取及适用范围以合成报告为准。
      </p>
      <details>
        <summary>查看分析依据与读取限制</summary>
        <p>{u1ReportOne.summary}</p>
        <ul>
          {u1ReportOne.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
        <p className="muted">{u1ReportOne.narrative}</p>
      </details>
      {u1.analysisStarted && !u1.analysisReady && u1.clarificationMode !== 'NONE' && (
        <div className="task-clarify">
          <h3>需要你确认的资料问题</h3>
          <ul>
            {questions.map((question) => (
              <li key={question.id}>
                <strong>{question.title}</strong> · {question.question}
              </li>
            ))}
          </ul>
          <label>
            答复
            <textarea
              aria-label="资料问题答复"
              value={answers}
              placeholder="说明四层结构、编号迁移、保留表单及补充资料的处理方式"
              onChange={(event) => {
                setAnswers(event.target.value);
              }}
            />
          </label>
          <p className="muted">答复只形成合成分析变化；不调用 Runner，也不自动批准保护内容。</p>
        </div>
      )}
      {u1.clarificationMode === 'NONE' && u1.analysisStarted && (
        <p className="notice" role="status">
          本轮分析没有必须答复的事项；不强制生成第二版报告。
        </p>
      )}
      {u1.analysisReady && (
        <div className="task-scope">
          <h3>确认修改范围</h3>
          <p>
            计划 {plan.planId} 第 {plan.version} 版 ·
            分别列出修订、新增与保留；确认对象是当前精确计划和输入依据。
          </p>
          <div className="task-table-wrap" role="region" aria-label="拟修改文件" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col">文件</th>
                  <th scope="col">层级</th>
                  <th scope="col">动作</th>
                  <th scope="col">影响</th>
                </tr>
              </thead>
              <tbody>
                {plan.files.map((file) => (
                  <tr key={file.id}>
                    <th scope="row">{file.title}</th>
                    <td>{planLevelLabels[file.level]}</td>
                    <td>{planActionLabels[file.action]}</td>
                    <td>{file.impact}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plan.retained.length > 0 && (
            <details>
              <summary>查看保留、不生成的文件</summary>
              <ul>
                {plan.retained.map((file) => (
                  <li key={file.id}>
                    <strong>{file.title}</strong> · {file.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details>
            <summary>查看输入依据、模板与保护内容边界</summary>
            <p>输入依据：{plan.inputBasis.map((basis) => basis.label).join('、')}</p>
            <p>正式模板：{plan.templateBasis.join('、')}</p>
            <p>
              质量方针、质量目标、人员架构、组织架构、关联流程和产品流程属于保护内容；本轮普通意见不授权变更，如需变更必须另行记录绑定版本的明确决定。
            </p>
          </details>
          {plan.state !== 'DRAFT' && plan.state !== 'CONFIRMED' && (
            <p className="notice" role="status">
              计划状态：{plan.state}。确认未收敛前不能生成；核对或重新确认原意图。
            </p>
          )}
        </div>
      )}
      {feedback && (
        <p className="muted" role="status">
          {feedback}
        </p>
      )}
    </section>
  );
}

function StagePanel({
  model,
  feedback,
  acknowledged,
  onAcknowledge,
  onSubmit,
  onFinalize,
}: {
  model: ReturnType<typeof useProjectModel>;
  feedback: string;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  onSubmit: (stage: MvpStageId) => void;
  onFinalize: (stage: MvpStageId) => void;
}) {
  const { u2, results } = model;
  const task = model.task;
  const stage = task.stage;
  if (!stage) return null;
  const info = model.infos.find((entry) => entry.stage === stage);
  if (!info) return null;
  const label = mvpStageLabel(stage);
  const upstream =
    stage === 'PROCEDURES'
      ? u2.manualFinalization
      : stage === 'RULES'
        ? u2.procedureFinalization
        : undefined;
  const canSubmit =
    info.roundSaved.length > 0 &&
    info.viewed.length === info.files.length &&
    !info.submitted &&
    !model.active &&
    info.ready.ready &&
    !info.unviewed;
  const finalizeNeedsAck = info.roundSaved.length > 0 && !info.submitted;
  return (
    <section className="panel task-stage" aria-label={`${label}当前工作`}>
      <div className="task-stage-head">
        <div>
          <h2>{label}</h2>
          <p className="muted">
            {info.finalization
              ? `已有模拟定稿 ${info.finalization.finalizationId}；旧定稿保留在历史中。`
              : '候选、阅读、意见与定稿在同一工作区完成；页面访问不会自动定稿。'}
          </p>
        </div>
        <span className="status-tag">
          {info.upstreamChanged
            ? '依据已变化，待复核'
            : info.finalization && !info.newerThanFinal
              ? '已定稿（模拟）'
              : info.unviewed
                ? '有新稿待查看'
                : info.roundSaved.length > 0 && !info.submitted
                  ? '有未提交意见'
                  : '待审阅（演示）'}
        </span>
      </div>
      {info.roundId && (
        <p>
          <Link className="button" to={`${base}/results/${encodeURIComponent(info.roundId)}`}>
            查看本轮结果总览
          </Link>
        </p>
      )}
      {!info.hasCandidate && info.lastUnresolved && (
        <div className="notice" role="status">
          <p>{info.lastUnresolved.message}</p>
          <div className="task-actions">
            <button className="button" onClick={() => u2.reconcileGeneration(stage)}>
              核对原生成请求
            </button>
            {(info.lastUnresolved.status === 'FAILED' ||
              info.lastUnresolved.status === 'MISMATCH') && (
              <button className="button primary" onClick={() => u2.retryGeneration(stage)}>
                重新生成本阶段
              </button>
            )}
          </div>
        </div>
      )}
      {info.unviewed && (
        <p className="notice" role="status">
          新稿已到达；当前阅读版本、意见与旧定稿保持不变。
          <button
            className="button"
            onClick={() => {
              u2.viewLatest(stage);
            }}
          >
            显式查看新稿
          </button>
        </p>
      )}
      <div className="task-table-wrap" role="region" aria-label="本阶段需审阅文件" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th scope="col">文件</th>
              <th scope="col">当前阅读版本</th>
              <th scope="col">本轮结果</th>
              <th scope="col">详情</th>
            </tr>
          </thead>
          <tbody>
            {info.files.map((file) => {
              const viewed = versionForFile(info.session, file.id);
              const latest = latestVersion(info.session, file.id);
              const state =
                file.action === 'RETAIN'
                  ? '沿用，不生成'
                  : !latest
                    ? '本轮未返回结果'
                    : viewed !== latest
                      ? `新稿 ${u2VersionLabel(latest)} 待查看`
                      : `候选 ${u2VersionLabel(latest)}`;
              return (
                <tr key={file.id}>
                  <th scope="row">
                    {file.title}
                    <small>
                      {planLevelLabels[file.level]} · {planActionLabels[file.action]}
                    </small>
                  </th>
                  <td>{viewed ? u2VersionLabel(viewed) : '—'}</td>
                  <td>{state}</td>
                  <td>
                    {viewed && info.roundId ? (
                      <Link to={fileDetailHref(info.roundId, file.id)}>查看</Link>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {info.versionId && (
        <div className="task-opinions">
          <h3>本轮意见（{info.roundSaved.length} 条）</h3>
          <p className="muted">
            编辑即保留在本次会话内存，并绑定文件、轮次与精确版本。提交与定稿是不同动作；总览和文件详情共用这一份意见。
          </p>
          {info.files.map((file) => {
            const version = versionForFile(info.session, file.id);
            if (!version || !info.roundId) return null;
            const key = opinionKey(info.roundId, file.id, version);
            const value = results.drafts[key] ?? results.saved[key]?.text ?? '';
            return (
              <label key={file.id} className="task-opinion">
                <span>
                  {file.title} · {u2VersionLabel(version)}
                </span>
                <textarea
                  aria-label={`${file.title} 本轮意见`}
                  value={value}
                  placeholder="记录对这份文件的意见；留空不提交"
                  onChange={(event) => {
                    results.setOpinion(
                      key,
                      `${file.title} · ${stageRoundLabel(model.plan, stage, version)}`,
                      event.target.value,
                    );
                  }}
                />
              </label>
            );
          })}
          <div className="task-actions">
            <button
              className="button primary"
              disabled={!canSubmit}
              onClick={() => {
                onSubmit(stage);
              }}
            >
              {info.submitted
                ? '本轮意见已提交'
                : `提交 ${info.roundSaved.length} 条意见并生成下一稿`}
            </button>
            <span className="muted" role="status">
              {results.receipt ||
                (model.active
                  ? `已有待处理修改请求 ${model.active.requestId}；请先核对原请求。`
                  : info.roundSaved.length === 0
                    ? '本轮尚未保留意见。'
                    : '提交后生成一个模拟修改意图，不直接定稿。')}
            </span>
          </div>
        </div>
      )}
      <div className="task-finalize">
        <h3>核对并定稿完整集合</h3>
        <p className="muted">
          定稿确认本阶段全部文件与精确版本；不提供逐文件批准，也不允许取消必需成员。第三阶段定稿与最终交付确认仍是两个决定。
        </p>
        <ul>
          {info.files.map((file) => {
            const version = versionForFile(info.session, file.id);
            return (
              <li key={file.id}>
                {file.title} · {version ? u2VersionLabel(version) : '缺少版本'}
              </li>
            );
          })}
        </ul>
        {upstream && (
          <p className="muted">
            上游依据：{upstream.finalizationId} ·{' '}
            {upstream.files.map((ref) => `${ref.fileId}@${ref.versionId}`).join('、')}
          </p>
        )}
        {info.upstreamChanged && (
          <p className="notice" role="status">
            上游依据已变化；旧定稿仍保留，需明确核对当前完整集合后重新确认。
          </p>
        )}
        {finalizeNeedsAck && (
          <label className="task-warning">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => {
                onAcknowledge(event.target.checked);
              }}
            />
            本轮有 {info.roundSaved.length}{' '}
            条未提交意见；我已知悉它们不会进入定稿依据，仍要继续核对定稿。
          </label>
        )}
        <div className="task-actions">
          <button
            className="button"
            disabled={
              !info.ready.ready ||
              info.viewed.length !== info.files.length ||
              info.unviewed ||
              Boolean(model.active) ||
              (finalizeNeedsAck && !acknowledged)
            }
            onClick={() => {
              onFinalize(stage);
            }}
          >
            {info.finalization ? '按当前依据重新确认完整集合' : '确认本阶段完整集合（模拟）'}
          </button>
          {info.finalization && (
            <span className="muted" role="status">
              已定稿：{info.finalization.finalizationId}
            </span>
          )}
        </div>
        <p className="muted" role="status">
          {feedback}
        </p>
      </div>
    </section>
  );
}

function RecoveryPanel({
  model,
  enabled,
}: {
  model: ReturnType<typeof useProjectModel>;
  enabled: boolean;
}) {
  if (!enabled) return null;
  const execution = model.u3.execution;
  const recovery = model.recovery;
  return (
    <section className="panel task-recovery" aria-label="当前工作中的恢复">
      <h2>执行与恢复</h2>
      <p>{execution.batch.statusNote}</p>
      <ul>
        {execution.files
          .filter((file) => file.error ?? file.stateLabel.includes('失败'))
          .map((file) => (
            <li key={file.fileId}>
              {file.title} · {file.stateLabel} {file.error ? `· ${file.error}` : ''}
            </li>
          ))}
      </ul>
      <p role="status">{recovery.note}</p>
      <div className="task-actions">
        <button className="button primary" disabled={!recovery.canRetry} onClick={recovery.retry}>
          仅重试已知失败文件
        </button>
        <button className="button" disabled={!recovery.canQuery} onClick={recovery.query}>
          核对原重试请求
        </button>
        {execution.retry.onReceipt && (
          <MockControls>
            <button className="button" onClick={execution.retry.onReceipt}>
              模拟原重试回执到达
            </button>
          </MockControls>
        )}
      </div>
      {execution.retry.history.length > 0 && (
        <details>
          <summary>查看重试历史</summary>
          <ul>
            {execution.retry.history.map((entry) => (
              <li key={entry.requestId}>
                {entry.requestId} · {entry.status} · {entry.note}
              </li>
            ))}
          </ul>
        </details>
      )}
      {execution.late.records.length > 0 && (
        <details>
          <summary>查看迟到或旧结果</summary>
          <ul>
            {execution.late.records.map((record) => (
              <li key={record.resultId}>
                {record.resultId} · {record.disposition} · {record.note}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function DeliveryPanel({ model }: { model: ReturnType<typeof useProjectModel> }) {
  const delivery = model.delivery;
  const task = model.task;
  const packagingUnresolved = Boolean(
    delivery.state.packagingFrozen &&
    (delivery.state.packagingStatus === 'PENDING' ||
      delivery.state.packagingStatus === 'UNKNOWN' ||
      delivery.state.packagingStatus === 'MISMATCH' ||
      delivery.state.packagingStatus === 'FAILED'),
  );
  const deliveryTask =
    task.key === 'DELIVERY_CONFIRM' ||
    task.key === 'DELIVERY_RECONCILE' ||
    task.key === 'PACKAGING' ||
    task.key === 'PACKAGING_RECOVERY' ||
    task.key === 'DOWNLOAD';
  if (!deliveryTask && !delivery.state.frozen && !delivery.state.packagingFrozen) return null;
  return (
    <section className="panel task-delivery" aria-label="最终交付">
      <h2>最终交付</h2>
      <dl className="task-bases">
        <div>
          <dt>质量手册定稿</dt>
          <dd>{delivery.bases.manualLabel}</dd>
        </div>
        <div>
          <dt>控制程序完整集合</dt>
          <dd>{delivery.bases.procedureLabel}</dd>
        </div>
        <div>
          <dt>管理制度及记录表单</dt>
          <dd>{delivery.bases.rulesLabel}</dd>
        </div>
      </dl>
      {delivery.blockers.length > 0 && (
        <div className="error" role="alert">
          <strong>当前不能确认最终交付</strong>
          <ul>
            {delivery.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}
      <h3>待交付精确清单</h3>
      {delivery.proposal.members.length === 0 ? (
        <p role="status">尚无可用精确版本；请先完成三阶段定稿。</p>
      ) : (
        <div className="task-table-wrap" role="region" aria-label="待交付精确清单" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">文件</th>
                <th scope="col">阶段</th>
                <th scope="col">精确版本</th>
              </tr>
            </thead>
            <tbody>
              {delivery.proposal.members.map((member) => (
                <tr key={member.fileId}>
                  <th scope="row">{member.title}</th>
                  <td>{member.stage}</td>
                  <td>
                    {member.versionLabel} · {member.versionId}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {packagingUnresolved && delivery.state.packagingFrozen && (
        <details className="task-package-history" open>
          <summary>原打包请求与冻结清单</summary>
          <p>
            {delivery.state.packagingRequestLabel ?? '原打包请求'} ·{' '}
            {delivery.state.packagingStatus === 'FAILED'
              ? '打包失败'
              : delivery.state.packagingStatus === 'PENDING'
                ? '打包中'
                : delivery.state.packagingStatus === 'UNKNOWN'
                  ? '结果待核验'
                  : '回执与清单不匹配'}
          </p>
          <ul>
            {delivery.state.packagingFrozen.members.map((member) => (
              <li key={member.fileId}>
                {member.title} · {member.versionLabel} · {member.versionId}
              </li>
            ))}
          </ul>
          <p className="muted">该请求绑定旧的冻结清单；在核对或重试收敛前，不会覆盖为新确认。</p>
        </details>
      )}
      <p className="muted">
        确认与打包是两个内部事实：确认成功后才对同一冻结清单打包；确认未知不会开始打包。失败只重试同一清单。
      </p>
      <p role="status">{delivery.state.confirmNote || delivery.state.packagingNote}</p>
      <div className="task-actions">
        {packagingUnresolved && !delivery.state.frozen && (
          <>
            {(delivery.state.packagingStatus === 'UNKNOWN' ||
              delivery.state.packagingStatus === 'MISMATCH') && (
              <button className="button primary" onClick={delivery.actions.queryPackaging}>
                核对原打包请求
              </button>
            )}
            {delivery.state.packagingStatus === 'FAILED' && (
              <button className="button primary" onClick={delivery.actions.retryPackaging}>
                重试同一冻结清单
              </button>
            )}
            {delivery.state.packagingStatus === 'PENDING' && (
              <button className="button primary" disabled>
                正在打包…
              </button>
            )}
          </>
        )}
        {!packagingUnresolved && !delivery.state.frozen && (
          <>
            <button
              className="button primary"
              disabled={
                delivery.blockers.length > 0 ||
                delivery.state.confirmStatus === 'PENDING' ||
                delivery.state.confirmStatus === 'UNKNOWN' ||
                delivery.state.confirmStatus === 'MISMATCH'
              }
              onClick={delivery.actions.confirmAndPackage}
            >
              确认交付清单并生成文档包
            </button>
            {(delivery.state.confirmStatus === 'PENDING' ||
              delivery.state.confirmStatus === 'UNKNOWN' ||
              delivery.state.confirmStatus === 'MISMATCH') && (
              <button className="button" onClick={delivery.actions.reconcileConfirmation}>
                核对原最终确认请求
              </button>
            )}
            {delivery.state.confirmStatus === 'MISMATCH' && (
              <button className="button" onClick={delivery.actions.endConfirmation}>
                结束原确认请求并重新核对
              </button>
            )}
          </>
        )}
        {delivery.state.frozen && !delivery.state.packageAvailable && (
          <>
            <button
              className="button primary"
              disabled={delivery.state.packagingStatus === 'PENDING'}
              onClick={delivery.actions.retryPackaging}
            >
              {delivery.state.packagingStatus === 'FAILED'
                ? '重试同一冻结清单'
                : delivery.state.packagingStatus === 'UNKNOWN' ||
                    delivery.state.packagingStatus === 'MISMATCH'
                  ? '核对原打包请求'
                  : '打包已冻结清单'}
            </button>
            {(delivery.state.packagingStatus === 'UNKNOWN' ||
              delivery.state.packagingStatus === 'MISMATCH') && (
              <button className="button" onClick={delivery.actions.queryPackaging}>
                重新查询原打包请求
              </button>
            )}
          </>
        )}
        {delivery.state.currentPackage && delivery.state.packageAvailable && (
          <button
            className="button primary"
            onClick={() => {
              const pkg = delivery.state.currentPackage;
              if (pkg) delivery.actions.download(pkg);
            }}
          >
            下载 Markdown ZIP（合成）
          </button>
        )}
      </div>
      {delivery.state.currentPackage && (
        <div className="task-package" role="status">
          <h3>{delivery.state.currentPackage.label}</h3>
          <p>
            {delivery.state.currentPackage.id} · {delivery.state.currentPackage.createdAt} ·
            包可用（模拟）
          </p>
          <p>{delivery.state.currentPackage.reason}</p>
        </div>
      )}
      {delivery.state.packagingPackage &&
        !delivery.state.currentPackage &&
        delivery.state.packagingStatus === 'AVAILABLE' && (
          <div className="task-package" role="status">
            <h3>{delivery.state.packagingPackage.label} · 历史冻结清单</h3>
            <p>
              {delivery.state.packagingPackage.id} · {delivery.state.packagingPackage.createdAt} ·
              包可用（模拟）
            </p>
            <p>该包对应旧冻结清单；当前 proposal 已变化，需重新确认后才能形成新的当前交付。</p>
            <button
              className="button"
              onClick={() => {
                const pkg = delivery.state.packagingPackage;
                if (pkg) delivery.actions.download(pkg);
              }}
            >
              下载历史 ZIP
            </button>
          </div>
        )}
      {delivery.state.packages.length > 0 && (
        <details className="task-package-history">
          <summary>查看历史交付包</summary>
          <ul>
            {delivery.state.packages.map((pkg) => (
              <li key={pkg.id}>
                {pkg.id} · {pkg.createdAt} · {pkg.frozen.members.length} 份文件{' '}
                <button
                  className="button"
                  onClick={() => {
                    delivery.actions.download(pkg);
                  }}
                >
                  下载
                </button>
              </li>
            ))}
          </ul>
          <p className="muted">历史包成员与字节不随后续改稿或新包变化。</p>
        </details>
      )}
    </section>
  );
}

function DevControls({ model }: { model: ReturnType<typeof useProjectModel> }) {
  const { u1, u2, u3, plan } = model;
  const stage = model.task.stage ?? 'MANUAL';
  const session = stageSession(u2, plan, stage);
  return (
    <MockControls>
      <details className="fixture-options task-dev">
        <summary>演练与诊断</summary>
        <p>正常旅程不需要打开这些控件；回执、候选和故障注入只用于开发诊断。</p>
        <label>
          分析澄清场景
          <select
            value={u1.clarificationMode}
            onChange={(event) => {
              u1.setClarificationMode(event.target.value as 'QUESTIONS' | 'NONE');
            }}
          >
            <option value="QUESTIONS">需要答复 2 个问题</option>
            <option value="NONE">无需答复 · 不生成第二版</option>
          </select>
        </label>
        <label>
          范围确认场景
          <select
            value={u1.planScenario}
            onChange={(event) => {
              u1.setPlanScenario(event.target.value);
            }}
          >
            <option value="received">匹配回执</option>
            <option value="pending">待回执</option>
            <option value="failed">失败</option>
            <option value="unknown">UNKNOWN</option>
            <option value="mismatch">错上下文回执</option>
          </select>
        </label>
        <label>
          当前阶段生成场景
          <select
            value={session.generationScene}
            onChange={(event) => {
              u2.update(stage, (current) => ({
                ...current,
                generationScene: event.target.value as StageSession['generationScene'],
              }));
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
        <fieldset>
          <legend>交付场景</legend>
          <label>
            确认回执
            <select
              value={u3.deliveryApi.state.confirmScene}
              onChange={(event) => {
                u3.deliveryApi.actions.configure({
                  confirmScene: event.target.value as
                    'matched' | 'pending' | 'unknown' | 'failed' | 'mismatch' | 'changed',
                });
              }}
            >
              <option value="matched">匹配回执</option>
              <option value="pending">待回执</option>
              <option value="unknown">UNKNOWN</option>
              <option value="failed">失败</option>
              <option value="mismatch">错绑回执</option>
              <option value="changed">确认前依据变化</option>
            </select>
          </label>
          <label>
            打包结果
            <select
              value={u3.deliveryApi.state.packagingScene}
              onChange={(event) => {
                u3.deliveryApi.actions.configure({
                  packagingScene: event.target.value as
                    'AVAILABLE' | 'FAILED' | 'UNKNOWN' | 'MISMATCH',
                });
              }}
            >
              <option value="AVAILABLE">包可用</option>
              <option value="FAILED">打包失败</option>
              <option value="UNKNOWN">待核验</option>
              <option value="MISMATCH">错绑清单</option>
            </select>
          </label>
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={u3.recovery.visible}
            onChange={(event) => {
              u3.recovery.setVisible(event.target.checked);
            }}
          />
          显示执行恢复区（合成失败批次）
        </label>
        <button
          onClick={() => {
            u2.simulateManualRefinalization();
          }}
          disabled={!u2.manualFinalization}
        >
          模拟质量手册重新定稿（上游依据变化）
        </button>
        <button
          onClick={() => {
            u1.expandPlan(plan.planId);
          }}
        >
          扩大范围：新增变更通知单（演示）
        </button>
      </details>
    </MockControls>
  );
}

export function FixtureCurrentWork() {
  const params = useParams();
  const model = useProjectModel();
  const { u1, u2, results } = model;
  const [answers, setAnswers] = useState('');
  const [feedback, setFeedback] = useState('');
  const [pendingInitialGeneration, setPendingInitialGeneration] = useState(false);
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  if (params.projectId !== projectId) return <Missing />;
  const task = model.task;
  useEffect(() => {
    if (!pendingInitialGeneration) return;
    if (u2.planCheck.ready) {
      const session = stageSession(u2, model.plan, 'MANUAL');
      const hasCandidate = Object.values(session.files).some((file) => file.versions.length > 0);
      if (!hasCandidate) u2.generateInitial('MANUAL');
      setPendingInitialGeneration(false);
    }
  }, [pendingInitialGeneration, u2, model.plan]);
  useEffect(() => {
    setFeedback('');
    results.clearReceipt();
    // Clear only when the derived task changes, not on every context render.
  }, [task.key, task.stage]);

  const submitStage = (stage: MvpStageId) => {
    const info = model.infos.find((entry) => entry.stage === stage);
    if (!info?.versionId || info.roundSaved.length === 0) return;
    const manualFinalizationId = model.u2.manualFinalization?.finalizationId;
    const procedureFinalizationId = model.u2.procedureFinalization?.finalizationId;
    const rulesFinalizationId = model.u2.rulesFinalization?.finalizationId;
    const result = results.submitRound({
      planKey: sessionKey(model.plan, stage),
      planId: model.plan.planId,
      planVersion: model.plan.version,
      projectId,
      stage,
      text: info.roundSaved.map(([, entry]) => `${entry.label}：${entry.text}`).join('\n'),
      files: info.viewed,
      ...(manualFinalizationId ? { manualFinalizationId } : {}),
      ...(procedureFinalizationId ? { procedureFinalizationId } : {}),
      ...(stage === 'RULES' && rulesFinalizationId ? { rulesFinalizationId } : {}),
    });
    setFeedback(result.ok ? '已提交本轮意见；新稿到达后需显式查看。' : result.reason);
  };

  const finalize = (stage: MvpStageId) => {
    const info = model.infos.find((entry) => entry.stage === stage);
    if (!info) return;
    const needsAck = info.roundSaved.length > 0 && !info.submitted;
    if (needsAck && !acknowledged[stage]) {
      setFeedback('本轮还有未提交意见；请先明确处理或勾选知悉后再定稿。');
      return;
    }
    const result = model.u2.finalizeStage(stage);
    setFeedback(
      result.ok
        ? `已确认完整集合（模拟）：${result.finalizationId ?? ''}`
        : (result.reason ?? '当前不能定稿。'),
    );
  };

  const runPrimary = () => {
    setFeedback('');
    switch (task.key) {
      case 'START_ANALYSIS':
        u1.startAnalysis();
        break;
      case 'CLARIFY':
        if (!answers.trim()) {
          setFeedback('请先填写资料问题答复，或改用无需答复的演示场景。');
          return;
        }
        u1.submitAnswers(answers);
        break;
      case 'SCOPE':
        setPendingInitialGeneration(true);
        u1.confirmPlan(model.plan.planId, crypto.randomUUID());
        break;
      case 'PLAN_RECONCILE':
        u1.simulatePlanReceipt(model.plan.planId);
        u1.queryPlan(model.plan.planId);
        break;
      case 'PLAN_RETRY':
        setPendingInitialGeneration(true);
        u1.confirmPlan(model.plan.planId, crypto.randomUUID());
        break;
      case 'GENERATE': {
        if (!task.stage) return;
        const result = u2.generateInitial(task.stage);
        if (!result.ok) setFeedback(result.reason ?? '当前不能生成。');
        break;
      }
      case 'GEN_RECOVERY': {
        if (!task.stage) return;
        const info = model.infos.find((entry) => entry.stage === task.stage);
        const result =
          info?.lastUnresolved?.status === 'FAILED'
            ? u2.retryGeneration(task.stage)
            : u2.reconcileGeneration(task.stage);
        if (!result.ok) setFeedback(result.reason ?? '原请求仍需核对。');
        break;
      }
      case 'VIEW_NEW':
        if (task.stage) u2.viewLatest(task.stage);
        break;
      case 'SUBMIT':
        if (task.stage) submitStage(task.stage);
        break;
      case 'REVIEW':
        setFeedback('可在上方文件详情或本轮意见区继续记录；定稿按钮位于本阶段底部。');
        break;
      case 'REFINALIZE':
        if (task.stage) finalize(task.stage);
        break;
      case 'RECOVERY':
        if (model.recovery.canQuery) model.recovery.query();
        else model.recovery.retry();
        break;
      case 'DELIVERY_CONFIRM':
        model.delivery.actions.confirmAndPackage();
        break;
      case 'DELIVERY_RECONCILE':
        model.delivery.actions.reconcileConfirmation();
        break;
      case 'PACKAGING':
      case 'PACKAGING_RECOVERY':
        model.delivery.actions.retryPackaging();
        break;
      case 'DOWNLOAD': {
        const pkg = model.delivery.state.currentPackage;
        if (pkg) model.delivery.actions.download(pkg);
        break;
      }
    }
  };

  return (
    <div className="task-workspace">
      <JourneyNav
        current="work"
        analysisReportId={u1.viewedReportId}
        scopeEnabled={u1.analysisReady}
        reviewStages={u2.reviewStages}
      />
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {u1Project.customerLabel} · {u1Project.code} · {projectId}
          </p>
          <h1 tabIndex={-1}>当前工作</h1>
          <p className="muted">从项目事实进入当前任务；阅读、意见、定稿与恢复都在同一工作区。</p>
        </div>
      </div>
      <div className="demo" role="note">
        环境 A · 当前工作演练 ·
        资料、候选、回执、定稿与交付包均为合成状态；仅保留本次会话内存，刷新重置。
      </div>
      <section className="panel task-next" aria-label="当前任务">
        <p className="eyebrow">当前状态</p>
        <h2>{task.title}</h2>
        <p>{task.reason}</p>
        <div className="task-actions">
          <PrimaryAction task={task} onRun={runPrimary} />
          <Link className="button" to={`${base}/files`}>
            查看全部文件
          </Link>
          <Link className="button" to={`${base}/history`}>
            查看历史记录
          </Link>
        </div>
        <p className="muted" role="status">
          {feedback || '页面访问不会自动推进阶段；主要操作才会驱动模拟状态。'}
        </p>
      </section>
      <StepProgress infos={model.infos} task={task} />
      {(task.key === 'START_ANALYSIS' ||
        task.key === 'CLARIFY' ||
        task.key === 'SCOPE' ||
        task.key === 'PLAN_RECONCILE' ||
        task.key === 'PLAN_RETRY') && (
        <AnalysisPanel
          model={model}
          answers={answers}
          setAnswers={setAnswers}
          feedback={feedback}
        />
      )}
      <StagePanel
        model={model}
        feedback={feedback}
        acknowledged={Boolean(task.stage && acknowledged[task.stage])}
        onAcknowledge={(value) => {
          const stage = task.stage;
          if (stage) setAcknowledged((current) => ({ ...current, [stage]: value }));
        }}
        onSubmit={submitStage}
        onFinalize={finalize}
      />
      <RecoveryPanel model={model} enabled={model.recovery.visible} />
      <DeliveryPanel model={model} />
      <DevControls model={model} />
    </div>
  );
}

interface InventoryRow {
  id: string;
  fileId: string;
  title: string;
  source: string;
  kind: 'UPLOADED' | 'CONTAINER' | 'MEMBER' | 'EXPECTED' | 'NEW' | 'RETAINED';
  levelLabel: string;
  stage?: MvpStageId | undefined;
  reading: string;
  outcome: string;
  candidate?: string | undefined;
  finalization: string;
  pending: boolean;
  involved: boolean;
  detailHref?: string | undefined;
}

function useInventory(model: ReturnType<typeof useProjectModel>, filter: string) {
  const { u1, plan, infos } = model;
  const currentStage = model.task.stage ?? infos.find((info) => !info.finalization)?.stage;
  const currentInfo = infos.find((info) => info.stage === currentStage);
  const rows: InventoryRow[] = [];
  for (const batch of u1.batches) {
    for (const entry of batch.entries) {
      const kind: InventoryRow['kind'] =
        entry.format === 'RAR' ? 'CONTAINER' : entry.id.includes('-') ? 'MEMBER' : 'UPLOADED';
      const stage = stageOfPath(entry.path);
      const info = infos.find((item) => item.stage === stage);
      rows.push({
        id: `${batch.id}:${entry.id}`,
        fileId: entry.id,
        title: entry.path,
        source: `${batch.label} · ${batch.zipName}`,
        kind,
        levelLabel: stage ? mvpStageLabel(stage) : '补充资料',
        ...(stage ? { stage } : {}),
        reading: inputEntryLabels[entry.state],
        outcome:
          entry.state === 'FAILED' || entry.state === 'UNSUPPORTED'
            ? '读取受限或未支持'
            : stage && info?.finalization
              ? '已进入阶段定稿范围'
              : '已接收',
        finalization: '—',
        pending:
          entry.state === 'FAILED' || entry.state === 'UNSUPPORTED' || entry.state === 'LIMITED',
        involved: stage === currentStage,
        ...(stage && info?.versionId ? { detailHref: fileDetailHref(info.roundId, entry.id) } : {}),
      });
    }
  }
  for (const file of plan.files) {
    const stage = stageOfLevel(file.level);
    const info = infos.find((item) => item.stage === stage);
    const latest = info ? latestVersion(info.session, file.id) : undefined;
    const finalized = info?.finalization?.files.find((ref) => ref.fileId === file.id)?.versionId;
    const retained = file.action === 'RETAIN';
    rows.push({
      id: `PLAN:${file.id}`,
      fileId: file.id,
      title: file.title,
      source: '已确认修改范围',
      kind: retained ? 'RETAINED' : file.action === 'CREATE' ? 'NEW' : 'EXPECTED',
      levelLabel: planLevelLabels[file.level],
      stage,
      reading: file.action === 'CREATE' ? '无客户原件' : '客户原件已上传',
      outcome: retained
        ? '沿用，不生成'
        : finalized
          ? '已定稿'
          : latest
            ? info?.unviewed
              ? '有新稿待查看'
              : '有候选'
            : '尚未生成候选',
      ...(latest ? { candidate: u2VersionLabel(latest) } : {}),
      finalization: finalized ? u2VersionLabel(finalized) : '未定稿',
      pending: !retained && !finalized,
      involved: stage === currentStage,
      ...(latest && info?.versionId ? { detailHref: fileDetailHref(info.roundId, file.id) } : {}),
    });
  }
  for (const file of plan.retained) {
    rows.push({
      id: `RETAIN:${file.id}`,
      fileId: file.id,
      title: file.title,
      source: '保留文件',
      kind: 'RETAINED',
      levelLabel: '客户内部记录',
      reading: '客户原件保留',
      outcome: '沿用，不生成',
      finalization: '不进入定稿',
      pending: false,
      involved: false,
      detailHref: undefined,
    });
  }
  const filtered = rows.filter((row) => {
    if (filter === 'STAGE') return row.stage === currentStage;
    if (filter === 'ROUND') return row.involved;
    if (filter === 'PENDING') return row.pending;
    return filter === 'ALL';
  });
  const uploaded = rows.filter((row) => row.kind === 'UPLOADED' || row.kind === 'MEMBER');
  return {
    rows: filtered,
    counts: {
      uploaded: uploaded.length,
      containers: rows.filter((row) => row.kind === 'CONTAINER').length,
      expected: rows.filter((row) => row.kind === 'EXPECTED').length,
      newFiles: rows.filter((row) => row.kind === 'NEW').length,
      retained: rows.filter((row) => row.kind === 'RETAINED').length,
      pending: rows.filter((row) => row.pending).length,
      involved: rows.filter((row) => row.involved).length,
    },
    currentStage,
    currentInfo,
  };
}

export function FixtureAllFiles() {
  const params = useParams();
  const model = useProjectModel();
  const [filter, setFilter] = useState('ALL');
  const inventory = useInventory(model, filter);
  if (params.projectId !== projectId) return <Missing />;
  const unresolved = model.infos.filter((info) => info.lastUnresolved);
  return (
    <div className="task-workspace">
      <JourneyNav
        current="files"
        analysisReportId={model.u1.viewedReportId}
        scopeEnabled={model.u1.analysisReady}
        reviewStages={model.u2.reviewStages}
      />
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {u1Project.customerLabel} · {u1Project.code} · {projectId}
          </p>
          <h1 tabIndex={-1}>全部文件</h1>
          <p className="muted">
            完整清单保留批次、容器、成员、预期与新增；不因当前任务聚焦而丢弃输入。
          </p>
        </div>
      </div>
      <div className="demo" role="note">
        环境 A · 全部文件演练 · 状态来自同一份合成会话；刷新重置。
      </div>
      <section className="panel task-cross" aria-label="影响当前工作的阻断">
        <h2>影响当前工作的阻断</h2>
        {unresolved.length === 0 && !model.active && model.delivery.blockers.length === 0 ? (
          <p className="notice" role="status">
            当前没有已知的跨阶段执行阻断。
          </p>
        ) : (
          <ul>
            {unresolved.map((info) => (
              <li key={info.stage}>
                {mvpStageLabel(info.stage)} · {info.lastUnresolved?.status} ·{' '}
                {info.lastUnresolved?.message}
              </li>
            ))}
            {model.active && (
              <li>仍有待处理修改请求 {model.active.requestId}；不能启动第二个批次。</li>
            )}
            {model.delivery.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        )}
        <Link className="button primary" to={workPath}>
          返回当前工作
        </Link>
      </section>
      <section className="panel task-inventory" aria-label="完整文件清单">
        <div className="task-inventory-head">
          <div>
            <h2>完整文件清单</h2>
            <p className="muted">
              上传成员 {inventory.counts.uploaded} · 容器 {inventory.counts.containers} · 预期/计划{' '}
              {inventory.counts.expected} · 计划新增 {inventory.counts.newFiles} · 保留{' '}
              {inventory.counts.retained} · 待处理 {inventory.counts.pending} · 本轮涉及{' '}
              {inventory.counts.involved}
            </p>
          </div>
          <nav className="task-filters" aria-label="文件筛选">
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
                aria-pressed={filter === id}
                onClick={() => {
                  setFilter(id);
                }}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
        <div className="task-table-wrap" role="region" aria-label="完整文件清单" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">文件 / 来源</th>
                <th scope="col">层级/阶段</th>
                <th scope="col">读取</th>
                <th scope="col">本轮结果</th>
                <th scope="col">候选</th>
                <th scope="col">人工定稿</th>
                <th scope="col">详情</th>
              </tr>
            </thead>
            <tbody>
              {inventory.rows.map((row) => (
                <tr
                  key={row.id}
                  data-kind={row.kind}
                  data-pending={row.pending ? 'true' : undefined}
                >
                  <th scope="row">
                    {row.title}
                    <small>{row.source}</small>
                  </th>
                  <td>{row.levelLabel}</td>
                  <td>{row.reading}</td>
                  <td>{row.outcome}</td>
                  <td>{row.candidate ?? '—'}</td>
                  <td>{row.finalization}</td>
                  <td>{row.detailHref ? <Link to={row.detailHref}>查看</Link> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {inventory.rows.length === 0 && (
            <p role="status">当前筛选没有文件；完整清单与选择保留。</p>
          )}
        </div>
      </section>
    </div>
  );
}

export function FixtureHistory() {
  const params = useParams();
  const model = useProjectModel();
  if (params.projectId !== projectId) return <Missing />;
  return (
    <div className="task-workspace">
      <JourneyNav
        current="history"
        analysisReportId={model.u1.viewedReportId}
        scopeEnabled={model.u1.analysisReady}
        reviewStages={model.u2.reviewStages}
      />
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {u1Project.customerLabel} · {u1Project.code} · {projectId}
          </p>
          <h1 tabIndex={-1}>历史记录</h1>
          <p className="muted">固定轮次、尝试、定稿与交付包；查看历史不改变项目当前任务。</p>
        </div>
      </div>
      <div className="demo" role="note">
        环境 A · 历史记录只读演练 · 历史身份与版本固定；刷新重置本次会话。
      </div>
      <section className="panel task-history-head">
        <p className="notice" role="status">
          正在查看历史记录；当前任务与本次阅读分开。
        </p>
        <Link className="button primary" to={workPath}>
          返回当前工作
        </Link>
      </section>
      <section className="panel" aria-label="分析报告">
        <h2>分析报告</h2>
        <ul>
          {[u1ReportOne, ...(model.u1.analysisReady ? [u1ReportTwo] : [])].map((report) => (
            <li key={report.reportId}>
              <Link to={`${base}/results/${report.version === 1 ? 'ANALYSIS-1' : 'ANALYSIS-2'}`}>
                {report.reportId} · 第 {report.version} 版
              </Link>
              <p>{report.summary}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel" aria-label="阶段轮次与定稿">
        <h2>阶段轮次与定稿</h2>
        {model.infos.map((info) => {
          const versions = [
            ...new Set(info.files.flatMap((file) => info.session.files[file.id]?.versions ?? [])),
          ].sort();
          return (
            <section key={info.stage}>
              <h3>{mvpStageLabel(info.stage)}</h3>
              {versions.length === 0 ? (
                <p className="muted">尚无候选轮次。</p>
              ) : (
                <ul>
                  {versions.map((version) => (
                    <li key={version}>
                      <Link
                        to={`${base}/results/${encodeURIComponent(stageRoundId(model.plan, info.stage, version))}`}
                      >
                        {stageRoundLabel(model.plan, info.stage, version)}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {info.session.generationAttempts.length > 0 && (
                <details>
                  <summary>查看生成尝试</summary>
                  <ul>
                    {info.session.generationAttempts.map((attempt) => (
                      <li key={attempt.requestId}>
                        {attempt.requestId} · {attempt.status} · {attempt.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <p>当前定稿：{info.finalization ? info.finalization.finalizationId : '未定稿'}</p>
              {info.session.finalizationHistory.length > 0 && (
                <details>
                  <summary>查看历史定稿</summary>
                  <ul>
                    {info.session.finalizationHistory.map((entry) => (
                      <li key={entry.finalization.finalizationId}>
                        {entry.finalization.finalizationId} · 被 {entry.supersededBy} 替代
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          );
        })}
      </section>
      <section className="panel" aria-label="交付包历史">
        <h2>交付包历史</h2>
        {model.delivery.state.packages.length === 0 ? (
          <p role="status">尚无交付包。</p>
        ) : (
          <ul>
            {model.delivery.state.packages.map((pkg) => (
              <li key={pkg.id}>
                {pkg.id} · {pkg.createdAt} · {pkg.frozen.members.length} 份文件{' '}
                <button
                  className="button"
                  onClick={() => {
                    model.delivery.actions.download(pkg);
                  }}
                >
                  下载
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted">后续改稿或新包不改变历史包成员与字节。</p>
      </section>
    </div>
  );
}
