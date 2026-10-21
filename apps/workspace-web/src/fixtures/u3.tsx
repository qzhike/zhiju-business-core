// DEVELOPMENT_U3_ADAPTER_ONLY: isolated rework/recovery/delivery adapter. It
// consumes the U1/U2 project context, never reads customer files or calls
// Core/Runner, and keeps every request, attempt, package and download in page
// memory. The rehearsal ZIP is synthetic and never a production export.
import { createContext, useContext, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { Missing } from '../shell.js';
import type { JourneyReviewStage } from '../mvp/JourneyNav.js';
import { ReworkPage, type ReworkPageProps } from '../mvp/ReworkPage.js';
import { RecoveryPage, type RecoveryPageProps } from '../mvp/RecoveryPage.js';
import { DeliveryFlowPage, type DeliveryFlowPageProps } from '../mvp/DeliveryFlowPage.js';
import {
  activeSubmission,
  draftAfterEditInPlace,
  draftAfterSaveReceipt,
  draftSaveUnresolved,
  draftWhileSaving,
  emptyDraft,
  mvpDraftStateLabels,
  type MvpDraft,
  type MvpStageId,
  type StageFinalization,
} from '../mvp/review-model.js';
import type { PlanView } from '../plan/model.js';
import {
  attemptOutcome,
  candidateMarkdown,
  classifyLateResult,
  deliveryBlockers,
  deliveryIntentFromSelection,
  deliveryIntentKey,
  deliveryListKey,
  deliveryReceiptMatches,
  executionStateLabels,
  frozenFromIntent,
  retryIntentFor,
  retryReceiptMatches,
  successfulVersions,
  type DeliveryIntent,
  type DeliveryPackage,
  type DeliveryProposal,
  type DeliveryReceipt,
  type DeliverySelection,
  type DownloadFact,
  type ExecutionAttempt,
  type ExecutionFileObservation,
  type FrozenDelivery,
  type LateResultClassification,
  type LateResultRecord,
  type PackagingAttempt,
  type PackagingStatus,
  type RetryIntent,
  type RetryReceipt,
  type SelectionIssues,
} from '../mvp/u3-model.js';
import { MvpHandoffContext, type MvpHandoff } from './handoff.js';
import { FixtureDelivery } from './delivery.js';
import { u1Project } from './u1-data.js';
import { u2Candidate, u2VersionLabel, u2VersionsFor } from './u2-data.js';
import {
  emptySession,
  manualReworkImpact,
  planStageFiles,
  recordsReworkState,
  sessionKey,
  useU2,
  type StageSession,
} from './u2.js';
import { useU1 } from './u1.js';
import {
  addSessionVersion,
  adoptLatestVersions,
  u3ExecutionErrors,
  u3ExecutionFixedInputs,
  u3ExecutionSeedFiles,
} from './u3-data.js';

const projectId = u1Project.id;
const manualPath = `/projects/${projectId}/stages/manual`;
const proceduresPath = `/projects/${projectId}/stages/procedures`;
const recordsPath = `/projects/${projectId}/stages/records`;
const reworkPath = `/projects/${projectId}/rework`;
const recoveryPath = `/projects/${projectId}/recovery`;
const deliveryPath = `/projects/${projectId}/delivery`;
const scopePath = `/projects/${projectId}/startup/U1-REPORT-02`;

function latestSet(plan: PlanView, stage: MvpStageId, session: StageSession) {
  return planStageFiles(plan, stage).flatMap((file) => {
    const latest = session.files[file.id]?.versions.at(-1);
    return latest ? [{ fileId: file.id, versionId: latest }] : [];
  });
}

function titleFor(plan: PlanView, fileId: string): string {
  return plan.files.find((file) => file.id === fileId)?.title ?? fileId;
}

interface ConfirmRequest {
  intent: DeliveryIntent;
  receipt?: DeliveryReceipt | undefined;
}

interface DeliveryState {
  selection?: DeliverySelection | undefined;
  confirmScene: 'matched' | 'mismatch' | 'pending' | 'unknown' | 'failed' | 'changed';
  confirmStatus: 'NONE' | 'PENDING' | 'UNKNOWN' | 'FAILED' | 'MISMATCH' | 'DONE';
  confirmRequest?: ConfirmRequest | undefined;
  confirmNote: string;
  frozen?: FrozenDelivery | undefined;
  packagingScene: 'AVAILABLE' | 'FAILED' | 'UNKNOWN' | 'MISMATCH';
  packagingStatus: PackagingStatus;
  packagingRequest?: PackagingAttempt | undefined;
  packagingNote: string;
  packages: DeliveryPackage[];
  downloadScene: 'SENT' | 'FAILED' | 'UNKNOWN';
  note: string;
}

interface ExecutionState {
  attempts: ExecutionAttempt[];
  retryScene: 'matched' | 'pending' | 'unknown' | 'failed' | 'mismatch';
  retryStatus: 'NONE' | 'PENDING' | 'UNKNOWN' | 'FAILED' | 'MISMATCH' | 'RECEIVED';
  retryRequest?: { intent: RetryIntent; receipt?: RetryReceipt | undefined } | undefined;
  retryNote: string;
  late: readonly (LateResultRecord & { filesLabel: string })[];
  draft: MvpDraft;
  draftScene: 'SAVED' | 'FAILED' | 'UNKNOWN';
  history: readonly {
    id: string;
    text: string;
    status: string;
    requestLabel: string;
    basis: string;
  }[];
  saveNote: string;
}

function initialExecution(planId: string, planVersion: number): ExecutionState {
  const attempt: ExecutionAttempt = {
    attemptId: 'U3-ATTEMPT-01',
    requestId: 'U3-ROUND-01',
    projectId,
    planId,
    planVersion,
    label: '本轮修改批次 A1',
    trigger: 'INITIAL',
    createdAt: '2026-10-21 10:10',
    files: u3ExecutionSeedFiles.map((file): ExecutionFileObservation => ({
      fileId: file.fileId,
      title: file.title,
      stage: file.stage,
      state: file.state,
      ...(file.versionId ? { versionId: file.versionId } : {}),
      ...(file.error ? { error: file.error } : {}),
      provenance: file.provenance,
      ...(file.linkedCorrection ? { linkedCorrection: file.linkedCorrection } : {}),
    })),
    fixedInputs: u3ExecutionFixedInputs,
    errors: u3ExecutionErrors,
    note: '四个成功/可审阅结果与两个已知失败同时保留；部分成功不表示阶段完成。',
  };
  return {
    attempts: [attempt],
    retryScene: 'matched',
    retryStatus: 'NONE',
    retryNote: '只对已知失败文件建立新尝试；成功文件保持原候选与历史。',
    late: [],
    draft: emptyDraft,
    draftScene: 'SAVED',
    history: [],
    saveNote: '',
  };
}

function initialDelivery(): DeliveryState {
  return {
    confirmScene: 'matched',
    confirmStatus: 'NONE',
    confirmNote: '一次显式确认冻结精确清单；阅读、候选到达或打包回执都不能代替确认。',
    packagingScene: 'AVAILABLE',
    packagingStatus: 'NONE',
    packagingNote: '确认冻结后才能打包；失败只重试同一冻结清单。',
    packages: [],
    downloadScene: 'SENT',
    note: '',
  };
}

/** Minimal uncompressed synthetic ZIP. Never used by production. */
function syntheticZip(frozen: FrozenDelivery): Uint8Array {
  const encoder = new TextEncoder();
  const entries = [
    {
      name: 'SYNTHETIC-MANIFEST.md',
      text: `# SYNTHETIC DEVELOPMENT SAMPLE\n\nEnvironment A rehearsal only. Not a controlled export.\nBasis: ${frozen.manualFinalizationId ?? 'none'} / ${frozen.procedureFinalizationId ?? 'none'} / ${frozen.recordsReviewId ?? 'none'}\n\n${frozen.members.map((member) => `${member.fileId}: ${member.versionId} (${member.stage})`).join('\n')}\n`,
    },
    ...frozen.members.map((member, index) => ({
      name: `${String(index + 1).padStart(2, '0')}-${member.fileId}.md`,
      text: `# ${member.title}\n\nSYNTHETIC DEVELOPMENT SAMPLE ONLY\nVersion: ${member.versionLabel} (${member.versionId})\nStage: ${member.stage}\n\n${member.content}`,
    })),
  ];
  const chunks: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  const header = (size: number) => new DataView(new ArrayBuffer(size));
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const content = encoder.encode(entry.text);
    let crc = 0xffffffff;
    for (const byte of content) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = header(30);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, content.length, true);
    local.setUint32(22, content.length, true);
    local.setUint16(26, name.length, true);
    const central = header(46);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, content.length, true);
    central.setUint32(24, content.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    chunks.push(new Uint8Array(local.buffer), name, content);
    directory.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + content.length;
  }
  const directorySize = directory.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = header(22);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  const output = new Uint8Array(offset + directorySize + 22);
  let position = 0;
  for (const chunk of [...chunks, ...directory, new Uint8Array(end.buffer)]) {
    output.set(chunk, position);
    position += chunk.length;
  }
  return output;
}

function proposalFor(
  plan: PlanView,
  manual: StageFinalization | undefined,
  procedure: StageFinalization | undefined,
  records: StageSession,
): DeliveryProposal {
  const versions = new Map<string, { versionId: string; stage: MvpStageId }>();
  for (const ref of manual?.files ?? [])
    versions.set(ref.fileId, { versionId: ref.versionId, stage: 'MANUAL' });
  for (const ref of procedure?.files ?? [])
    versions.set(ref.fileId, { versionId: ref.versionId, stage: 'PROCEDURES' });
  for (const ref of records.reworkReview?.files ?? [])
    versions.set(ref.fileId, { versionId: ref.versionId, stage: 'RECORDS' });
  const members = plan.files
    .filter((file) => file.action !== 'RETAIN')
    .flatMap((file) => {
      const entry = versions.get(file.id);
      if (!entry) return [];
      const data = u2Candidate(file.id, entry.versionId);
      if (!data) return [];
      return [
        {
          fileId: file.id,
          title: file.title,
          stage: entry.stage,
          versionId: entry.versionId,
          versionLabel: u2VersionLabel(entry.versionId),
          content: candidateMarkdown(data),
        },
      ];
    });
  return {
    projectId,
    planId: plan.planId,
    planVersion: plan.version,
    ...(manual ? { manualFinalizationId: manual.finalizationId } : {}),
    ...(procedure ? { procedureFinalizationId: procedure.finalizationId } : {}),
    ...(records.reworkReview ? { recordsReviewId: records.reworkReview.reviewId } : {}),
    members,
  };
}

interface U3Api {
  rework: ReworkPageProps;
  execution: RecoveryPageProps;
  delivery: DeliveryFlowPageProps;
}

const U3Context = createContext<U3Api | null>(null);

export function FixtureU3Provider({ children }: { children: ReactNode }) {
  const u1 = useU1();
  const u2 = useU2();
  const plan = u2.plan;
  const manualSession =
    u2.sessions[sessionKey(plan, 'MANUAL')] ?? emptySession(sessionKey(plan, 'MANUAL'), 'MANUAL');
  const procedureSession =
    u2.sessions[sessionKey(plan, 'PROCEDURES')] ??
    emptySession(sessionKey(plan, 'PROCEDURES'), 'PROCEDURES');
  const recordsSession =
    u2.sessions[sessionKey(plan, 'RECORDS')] ??
    emptySession(sessionKey(plan, 'RECORDS'), 'RECORDS');
  const manual = u2.manualFinalization;
  const procedure = u2.procedureFinalization;
  const [execution, setExecution] = useState<ExecutionState>(() =>
    initialExecution(plan.planId, plan.version),
  );
  const [delivery, setDelivery] = useState<DeliveryState>(() => initialDelivery());
  const procedureImpact = manualReworkImpact(plan, manual, procedure);
  const recordsState = recordsReworkState(plan, manual, procedure, recordsSession);
  const proposal = proposalFor(plan, manual, procedure, recordsSession);
  const requiredFileIds = plan.files
    .filter((file) => file.action !== 'RETAIN')
    .map((file) => file.id);
  const issues: SelectionIssues = delivery.selection
    ? deliveryBlockersIssues(delivery.selection, proposal, requiredFileIds)
    : { missingRequired: requiredFileIds, stale: [] };
  const currentRecordLatest = latestSet(plan, 'RECORDS', recordsSession);
  const active = activeSubmission(
    Object.values(u2.sessions).flatMap((session) => session.submissions),
  );
  const blockerInput = (selection: SelectionIssues) => ({
    planReady: u2.planCheck.ready,
    ...(u2.planCheck.reason !== undefined ? { planReason: u2.planCheck.reason } : {}),
    ...(manual ? { manual } : {}),
    ...(procedure ? { procedures: procedure } : {}),
    manualExpectedFiles: planStageFiles(plan, 'MANUAL').map((file) => file.id),
    procedureExpectedFiles: planStageFiles(plan, 'PROCEDURES').map((file) => file.id),
    ...(recordsSession.reworkReview ? { recordsReview: recordsSession.reworkReview } : {}),
    recordExpectedFiles: planStageFiles(plan, 'RECORDS').map((file) => file.id),
    currentRecordLatest,
    ...(active ? { activeSubmission: active.requestId } : {}),
    selection,
  });
  const blockers = deliveryBlockers(blockerInput(issues));
  const blockersWithoutSelection = deliveryBlockers(
    blockerInput({ missingRequired: [], stale: [] }),
  );

  const reworkActions: ReworkPageProps['actions'] = {
    announceManualDraft: () => {
      const latest = u2VersionsFor('F-MANUAL').at(-1) ?? 'V3';
      u2.update('MANUAL', (current) => ({
        ...addSessionVersion(current, 'F-MANUAL', latest),
        message: '模拟新手册草稿已到达；原定稿仍为当前依据，下游与交付不会自动更换。',
      }));
    },
    addDownstreamCandidates: () => {
      u2.update('PROCEDURES', (current) => ({
        ...addSessionVersion(current, 'F-PROCEDURE', u2VersionsFor('F-PROCEDURE').at(-1) ?? 'V3'),
        message: '已模拟新手册依据下的程序候选到达；请显式切换并核对。',
      }));
      u2.update('RECORDS', (current) => {
        let next = current;
        for (const file of planStageFiles(plan, 'RECORDS')) {
          if (u2VersionsFor(file.id).includes('V2')) next = addSessionVersion(next, file.id, 'V2');
        }
        return { ...next, message: '已模拟受影响记录表单候选到达；请逐份核对后再复核。' };
      });
    },
    adoptLatestDownstream: () => {
      u2.update('PROCEDURES', (current) => ({
        ...adoptLatestVersions(
          current,
          planStageFiles(plan, 'PROCEDURES').map((file) => file.id),
        ),
        message: '已显式采用第二阶段全部最新候选；请核对完整集合并重新定稿。',
      }));
    },
    adoptLatestRecords: () => {
      u2.update('RECORDS', (current) => ({
        ...adoptLatestVersions(
          current,
          planStageFiles(plan, 'RECORDS').map((file) => file.id),
        ),
        message: '已显式采用记录表单全部最新候选；请重新核对受影响表单与精确版本。',
      }));
    },
  };

  const manualDraftVersions =
    manual && manualSession.finalization
      ? planStageFiles(plan, 'MANUAL').flatMap((file) => {
          const latest = manualSession.files[file.id]?.versions.at(-1);
          if (
            !latest ||
            manual.files.some((ref) => ref.fileId === file.id && ref.versionId === latest)
          )
            return [];
          return [{ fileId: file.id, title: file.title, versionLabel: u2VersionLabel(latest) }];
        })
      : [];
  const previous = manualSession.finalizationHistory.at(-1);
  const rework: ReworkPageProps = {
    projectId,
    analysisReportId: u1.viewedReportId,
    plan: {
      planId: plan.planId,
      planVersion: plan.version,
      stateLabel: plan.state === 'CONFIRMED' ? '已确认 · 模拟回执' : plan.state,
    },
    reviewStages: u2.reviewStages,
    manual: {
      ...(manual ? { finalizationId: manual.finalizationId } : {}),
      files: (manual?.files ?? []).map((ref) => ({
        fileId: ref.fileId,
        title: titleFor(plan, ref.fileId),
        versionLabel: u2VersionLabel(ref.versionId),
      })),
      ...(previous
        ? {
            previous: {
              finalizationId: previous.finalization.finalizationId,
              supersededBy: previous.supersededBy,
              files: previous.finalization.files.map((ref) => ({
                fileId: ref.fileId,
                title: titleFor(plan, ref.fileId),
                versionLabel: u2VersionLabel(ref.versionId),
              })),
            },
          }
        : {}),
      draftVersions: manualDraftVersions,
    },
    procedures: {
      ...(procedure ? { finalizationId: procedure.finalizationId } : {}),
      ...(procedure?.manualFinalizationId ? { boundManualId: procedure.manualFinalizationId } : {}),
      ...(procedureImpact
        ? {
            impact: {
              sourceLabel: '质量手册重新定稿',
              previousBasisId: procedureImpact.previousBasisId,
              newBasisId: procedureImpact.newBasisId,
              note: procedureImpact.note,
              files: procedureImpact.files.map((file) => ({
                fileId: file.fileId,
                title: file.title,
                actionLabel: file.action === 'REVISE' ? '修改' : '保留',
                reason: file.reason,
              })),
            },
          }
        : {}),
      latestSet: latestSet(plan, 'PROCEDURES', procedureSession).map((ref) => ({
        fileId: ref.fileId,
        title: titleFor(plan, ref.fileId),
        versionLabel: u2VersionLabel(ref.versionId),
      })),
    },
    records: {
      ...(recordsState.active && recordsState.impact
        ? {
            impact: {
              sourceLabel: '第二阶段完整集合定稿',
              previousBasisId: recordsState.impact.previousBasisId,
              newBasisId: recordsState.impact.newBasisId,
              note: recordsState.impact.note,
              files: recordsState.impact.files.map((file) => ({
                fileId: file.fileId,
                title: file.title,
                actionLabel: file.action === 'REVISE' ? '修改' : '保留',
                reason: file.reason,
              })),
            },
          }
        : {}),
      reviewed: recordsState.reviewed,
      reason: recordsState.reason ?? '记录表单精确版本与两项上游依据一致；最终交付前需保持此复核。',
      basisLabel: recordsSession.reworkReview
        ? `${recordsSession.reworkReview.manualFinalizationId} · ${recordsSession.reworkReview.procedureFinalizationId}`
        : '尚未记录复核',
      files: (recordsSession.reworkReview?.files ?? []).map((ref) => ({
        fileId: ref.fileId,
        title: titleFor(plan, ref.fileId),
        versionLabel: u2VersionLabel(ref.versionId),
      })),
    },
    deliveryBlockers: blockersWithoutSelection,
    actions: reworkActions,
    links: {
      manual: manualPath,
      procedures: proceduresPath,
      records: recordsPath,
      recovery: recoveryPath,
      delivery: deliveryPath,
      scope: scopePath,
    },
  };

  const lastAttempt = execution.attempts.at(-1);
  const merged = new Map<string, ExecutionFileObservation>();
  for (const file of execution.attempts[0]?.files ?? []) merged.set(file.fileId, file);
  for (const file of lastAttempt?.files ?? []) merged.set(file.fileId, file);
  const currentFiles = [...merged.values()];
  const failedFiles = currentFiles.filter((file) => file.state === 'FAILED');
  const retryCanRun =
    failedFiles.length > 0 &&
    execution.retryStatus !== 'PENDING' &&
    execution.retryStatus !== 'UNKNOWN' &&
    execution.retryStatus !== 'RECEIVED';
  const executionProps: RecoveryPageProps = {
    projectId,
    analysisReportId: u1.viewedReportId,
    plan: {
      planId: plan.planId,
      planVersion: plan.version,
      stateLabel: plan.state === 'CONFIRMED' ? '已确认 · 模拟回执' : plan.state,
    },
    reviewStages: u2.reviewStages,
    batch: {
      requestId: execution.attempts[0]?.requestId ?? 'U3-ROUND-01',
      label: '本轮修改批次',
      statusLabel:
        execution.retryStatus === 'RECEIVED' ? '部分成功已恢复（模拟）' : '部分成功（模拟）',
      statusNote:
        execution.retryStatus === 'RECEIVED'
          ? '仅失败文件已完成恢复尝试；成功文件保持原候选与历史，仍不代表阶段完成。'
          : '成功候选、可审阅结果与已知失败同时保留；部分成功不表示阶段完成。',
      fixedInputs: u3ExecutionFixedInputs,
      errors: execution.attempts[0]?.errors ?? u3ExecutionErrors,
      note: '单项目仅一个活动修改批次；恢复只针对失败文件，不重新生成成功文件。',
      attempts: execution.attempts.map((attempt) => ({
        attemptId: attempt.attemptId,
        requestId: attempt.requestId,
        label: attempt.label,
        triggerLabel: attempt.trigger === 'INITIAL' ? '初始尝试' : '恢复尝试',
        outcomeLabel: attemptOutcome(attempt),
        createdAt: attempt.createdAt,
        fixedInputs: attempt.fixedInputs,
        errors: attempt.errors,
        note: attempt.note,
        files: attempt.files.map((file) => ({
          fileId: file.fileId,
          title: file.title,
          stateLabel: executionStateLabels[file.state],
          ...(file.versionId ? { versionLabel: u2VersionLabel(file.versionId) } : {}),
        })),
      })),
    },
    files: currentFiles.map((file) => ({
      fileId: file.fileId,
      title: file.title,
      stageLabel: file.stage,
      stateLabel: executionStateLabels[file.state],
      ...(file.versionId ? { candidateLabel: u2VersionLabel(file.versionId) } : {}),
      ...(file.error ? { error: file.error } : {}),
      provenance: file.provenance,
      ...(file.linkedCorrection
        ? {
            correction: {
              versionLabel: u2VersionLabel(file.linkedCorrection.versionId),
              reason: file.linkedCorrection.reason,
            },
          }
        : {}),
    })),
    retry: {
      status: execution.retryNote,
      ...(execution.retryRequest ? { requestLabel: execution.retryRequest.intent.requestId } : {}),
      note:
        execution.retryStatus === 'UNKNOWN'
          ? '原重试请求结果未知；只查询原请求，不启动第二次执行。'
          : '原尝试、固定输入和错误历史保留；重试意图只包含失败文件。',
      failedFiles: failedFiles.map((file) => file.title),
      canRetry: retryCanRun,
      canQuery:
        execution.retryStatus === 'PENDING' ||
        execution.retryStatus === 'UNKNOWN' ||
        execution.retryStatus === 'MISMATCH',
      onRetry: () => {
        requestRetry();
      },
      onQuery: () => {
        queryRetry();
      },
      ...(execution.retryStatus === 'PENDING' || execution.retryStatus === 'UNKNOWN'
        ? {
            onReceipt: () => {
              receiveRetry();
            },
          }
        : {}),
    },
    late: {
      note: '迟到或旧结果只追加到历史；不替换当前已接纳版本、阅读、草稿或阶段定稿。',
      records: execution.late.map((record) => ({
        resultId: record.resultId,
        ...(record.attemptId ? { attemptId: record.attemptId } : {}),
        disposition: record.disposition,
        note: record.note,
        receivedAt: record.receivedAt,
        filesLabel: record.filesLabel,
      })),
      onLateAfterBasisChange: () => {
        addLate('AFTER_BASIS_CHANGE');
      },
      onLateAfterNewerAttempt: () => {
        addLate('AFTER_NEWER_ATTEMPT');
      },
    },
    opinion: {
      draft: execution.draft,
      history: execution.history,
      onDraftChange: (text: string) => {
        setExecution((current) => ({
          ...current,
          draft: draftAfterEditInPlace(current.draft, text, {
            planId: plan.planId,
            planVersion: plan.version,
            ...(manual ? { manualFinalizationId: manual.finalizationId } : {}),
            ...(procedure ? { procedureFinalizationId: procedure.finalizationId } : {}),
            files: [],
          }),
        }));
      },
      onSave: () => {
        saveDraft();
      },
      saveNote: execution.saveNote,
      canSave: execution.draft.text.trim().length > 0 && !draftSaveUnresolved(execution.draft),
    },
    controls: (
      <details className="fixture-options" open>
        <summary>U3 执行恢复场景控制（演练）</summary>
        <label>
          重试回执场景
          <select
            value={execution.retryScene}
            onChange={(event) => {
              setExecution((current) => ({
                ...current,
                retryScene: event.target.value as ExecutionState['retryScene'],
              }));
            }}
          >
            <option value="matched">匹配回执 · 仅失败文件</option>
            <option value="pending">待回执</option>
            <option value="unknown">UNKNOWN</option>
            <option value="failed">已知失败</option>
            <option value="mismatch">错尝试/错项目回执</option>
          </select>
        </label>
        <label>
          意见保存回执
          <select
            value={execution.draftScene}
            onChange={(event) => {
              setExecution((current) => ({
                ...current,
                draftScene: event.target.value as ExecutionState['draftScene'],
              }));
            }}
          >
            <option value="SAVED">已保存到本页内存</option>
            <option value="FAILED">保存失败</option>
            <option value="UNKNOWN">保存结果待核验</option>
          </select>
        </label>
        <button
          onClick={() => {
            applyDraftReceipt();
          }}
          disabled={!draftSaveUnresolved(execution.draft)}
        >
          模拟原意见保存回执到达/查询
        </button>
        <p className="muted">
          {execution.draft.requestLabel
            ? `原保存请求 ${execution.draft.requestLabel} · ${mvpDraftStateLabels[execution.draft.state]}`
            : '当前没有待回收的意见保存请求。'}
        </p>
      </details>
    ),
    links: {
      manual: manualPath,
      procedures: proceduresPath,
      records: recordsPath,
      rework: reworkPath,
      delivery: deliveryPath,
    },
  };

  const canConfirm =
    blockers.length === 0 &&
    delivery.selection !== undefined &&
    issues.missingRequired.length === 0 &&
    issues.stale.length === 0 &&
    delivery.confirmStatus !== 'PENDING' &&
    delivery.confirmStatus !== 'UNKNOWN' &&
    delivery.confirmStatus !== 'DONE';
  const deliveryProps: DeliveryFlowPageProps = {
    projectId,
    analysisReportId: u1.viewedReportId,
    plan: {
      planId: plan.planId,
      planVersion: plan.version,
      stateLabel: plan.state === 'CONFIRMED' ? '已确认 · 模拟回执' : plan.state,
    },
    reviewStages: u2.reviewStages,
    bases: {
      manualLabel: manual
        ? `${manual.finalizationId} · ${manual.files.map((ref) => `${titleFor(plan, ref.fileId)} ${u2VersionLabel(ref.versionId)}`).join('；')}`
        : '尚无质量手册模拟定稿',
      procedureLabel: procedure
        ? `${procedure.finalizationId} · ${procedure.files.map((ref) => `${titleFor(plan, ref.fileId)} ${u2VersionLabel(ref.versionId)}`).join('；')}`
        : '尚无第二阶段完整集合定稿',
      recordsLabel: recordsSession.reworkReview
        ? `${recordsSession.reworkReview.reviewId} · ${recordsSession.reworkReview.files.map((ref) => `${titleFor(plan, ref.fileId)} ${u2VersionLabel(ref.versionId)}`).join('；')}`
        : '记录表单尚未复核',
    },
    blockers,
    proposal,
    selection: {
      selectedIds: delivery.selection?.members.map((member) => member.fileId) ?? [],
      stale: issues.stale.length > 0,
      onToggle: (fileId: string) => {
        setDelivery((current) => {
          if (!current.selection) return current;
          const exists = current.selection.members.some((member) => member.fileId === fileId);
          const member = proposal.members.find((entry) => entry.fileId === fileId);
          if (!exists && !member) return current;
          return {
            ...current,
            selection: {
              ...current.selection,
              members: exists
                ? current.selection.members.filter((entry) => entry.fileId !== fileId)
                : [...current.selection.members, member].filter(
                    (entry): entry is NonNullable<typeof entry> => entry !== undefined,
                  ),
            },
            confirmStatus: 'NONE',
            confirmRequest: undefined,
            confirmNote: '选择已变化；请重新核对后再次显式确认。',
          };
        });
      },
      onRecheck: () => {
        setDelivery((current) => ({
          ...current,
          selection: {
            proposalKey: deliveryListKey(proposal),
            members: proposal.members.map((member) => ({ ...member })),
          },
          confirmStatus: 'NONE',
          confirmRequest: undefined,
          confirmNote: '已按当前精确清单重新核对；请显式确认冻结。',
          note: '',
        }));
      },
    },
    confirmation: {
      status: delivery.confirmStatus,
      ...(delivery.confirmRequest
        ? { requestLabel: delivery.confirmRequest.intent.requestId }
        : {}),
      note: delivery.confirmNote,
      canConfirm,
      onConfirm: () => {
        confirmDelivery();
      },
      onQuery: () => {
        queryConfirmation();
      },
      ...(delivery.confirmRequest
        ? {
            onReceipt: () => {
              setDelivery((current) => {
                const request = current.confirmRequest;
                if (!request || request.receipt) return current;
                const receipt =
                  current.confirmScene === 'mismatch'
                    ? wrongReceipt(request.intent)
                    : exactReceipt(request.intent);
                return {
                  ...current,
                  confirmRequest: { ...request, receipt },
                  confirmNote: '原定稿回执已到达；请显式查询原请求，不自动冻结。',
                };
              });
            },
          }
        : {}),
      ...(delivery.frozen ? { frozen: delivery.frozen } : {}),
    },
    packaging: {
      status: delivery.packagingStatus,
      note: delivery.packagingNote,
      ...(delivery.packagingRequest ? { requestLabel: delivery.packagingRequest.requestId } : {}),
      canStart:
        delivery.frozen !== undefined &&
        (delivery.packagingStatus === 'NONE' ||
          delivery.packagingStatus === 'FAILED' ||
          delivery.packagingStatus === 'MISMATCH'),
      canQuery: delivery.packagingStatus === 'UNKNOWN' || delivery.packagingStatus === 'MISMATCH',
      canRetry: delivery.packagingStatus === 'FAILED',
      onStart: () => {
        startPackaging();
      },
      onQuery: () => {
        queryPackaging();
      },
      onRetry: () => {
        startPackaging();
      },
      ...(delivery.packages.find((pkg) => pkg.id === delivery.packagingRequest?.packageId)
        ? {
            package: delivery.packages.find(
              (pkg) => pkg.id === delivery.packagingRequest?.packageId,
            ),
          }
        : {}),
    },
    packages: delivery.packages,
    onDownload: (pkg) => {
      downloadPackage(pkg);
    },
    downloadScene: delivery.downloadScene,
    onDownloadScene: (scene) => {
      setDelivery((current) => ({
        ...current,
        downloadScene: scene as DeliveryState['downloadScene'],
      }));
    },
    controls: (
      <details className="fixture-options" open>
        <summary>U3 交付场景控制（演练）</summary>
        <label>
          确认回执场景
          <select
            value={delivery.confirmScene}
            onChange={(event) => {
              setDelivery((current) => ({
                ...current,
                confirmScene: event.target.value as DeliveryState['confirmScene'],
              }));
            }}
          >
            <option value="matched">匹配回执</option>
            <option value="pending">待回执</option>
            <option value="unknown">UNKNOWN</option>
            <option value="failed">失败</option>
            <option value="mismatch">错绑回执</option>
            <option value="changed">确认前版本/依据变化</option>
          </select>
        </label>
        <label>
          打包回执场景
          <select
            value={delivery.packagingScene}
            onChange={(event) => {
              setDelivery((current) => ({
                ...current,
                packagingScene: event.target.value as DeliveryState['packagingScene'],
              }));
            }}
          >
            <option value="AVAILABLE">包可用</option>
            <option value="FAILED">打包失败</option>
            <option value="UNKNOWN">打包结果待核验</option>
            <option value="MISMATCH">错绑冻结清单</option>
          </select>
        </label>
        <button
          onClick={() => {
            simulateRecordRevision();
          }}
        >
          模拟记录表单后续改稿（第 3 版）
        </button>
        <button
          onClick={() => {
            startNewRound();
          }}
          disabled={!delivery.frozen}
        >
          开始新一轮最终交付确认（保留历史包）
        </button>
        <p className="muted">{delivery.note}</p>
      </details>
    ),
    links: {
      manual: manualPath,
      procedures: proceduresPath,
      records: recordsPath,
      rework: reworkPath,
      recovery: recoveryPath,
    },
  };

  const unconfirmedNext =
    u1.acknowledgedReportVersion === 2
      ? {
          label: '核对修改范围',
          href: scopePath,
          reason: '第 2 版分析已核对；下一步确认精确文件范围与输入依据。',
        }
      : u1.reportTwoAvailable
        ? {
            label: '查看第 2 版分析',
            href: `/projects/${projectId}/analysis/U1-REPORT-02`,
            reason: '第 2 版分析已到达，需主动查看并核对本轮变化。',
          }
        : {
            label: '查看资料批次',
            href: `/projects/${projectId}/intake`,
            reason: '先核对资料批次和读取限制，再进入分析与澄清。',
          };
  const handoff = buildHandoff({
    reviewStages: u2.reviewStages,
    planCheck: u2.planCheck,
    unconfirmedNext,
    manual,
    procedure,
    procedureImpact: Boolean(procedureImpact),
    recordsReviewed: recordsState.reviewed,
    recordsImpact: recordsState.active,
    deliveryFrozen: delivery.frozen !== undefined,
  });
  const api: U3Api = { rework, execution: executionProps, delivery: deliveryProps };
  return (
    <U3Context.Provider value={api}>
      <MvpHandoffContext.Provider value={handoff}>{children}</MvpHandoffContext.Provider>
    </U3Context.Provider>
  );

  function requestRetry() {
    setExecution((current) => {
      const attempt = current.attempts.at(-1);
      if (!attempt) return current;
      if (current.retryStatus === 'PENDING' || current.retryStatus === 'UNKNOWN')
        return {
          ...current,
          retryNote: '原重试请求仍未决；只查询原请求，不创建第二个执行意图。',
        };
      const intent = retryIntentFor(attempt, `U3-RETRY-${crypto.randomUUID().slice(0, 8)}`);
      if (!intent)
        return {
          ...current,
          retryNote: '当前没有已知失败文件；成功文件不会重新生成。',
        };
      if (current.retryScene === 'failed')
        return {
          ...current,
          retryStatus: 'FAILED',
          retryRequest: { intent },
          retryNote: '模拟重试失败；原尝试、成功候选与错误历史保留，可再次只重试失败文件。',
        };
      if (current.retryScene === 'pending' || current.retryScene === 'unknown')
        return {
          ...current,
          retryStatus: current.retryScene === 'pending' ? 'PENDING' : 'UNKNOWN',
          retryRequest: { intent },
          retryNote:
            current.retryScene === 'pending'
              ? '重试请求待回执；重复点击不会创建第二个意图。'
              : '重试结果未知；只查询原尝试，不启动第二次执行。',
        };
      if (current.retryScene === 'mismatch') {
        const wrong: RetryReceipt = {
          classification: 'DEVELOPMENT_FIXTURE_ONLY',
          ...intent,
          attemptId: 'U3-OTHER-ATTEMPT',
          status: 'UNKNOWN',
        };
        return {
          ...current,
          retryStatus: 'PENDING',
          retryRequest: { intent, receipt: wrong },
          retryNote: '模拟回执属于其他尝试；请查询原请求核对。',
        };
      }
      return {
        ...current,
        retryStatus: 'PENDING',
        retryRequest: { intent },
        retryNote: '重试请求待回执；请显式查询原请求，不自动轮询。',
      };
    });
  }

  function receiveRetry() {
    setExecution((current) => {
      const request = current.retryRequest;
      if (!request || request.receipt) return current;
      const receipt: RetryReceipt = {
        classification: 'DEVELOPMENT_FIXTURE_ONLY',
        ...request.intent,
        status: 'ACCEPTED',
      };
      return {
        ...current,
        retryRequest: { ...request, receipt },
        retryNote: '原重试回执已到达；请显式查询原请求，不自动生成第二个尝试。',
      };
    });
  }

  function queryRetry() {
    setExecution((current) => {
      const request = current.retryRequest;
      if (!request) return current;
      if (!request.receipt)
        return {
          ...current,
          retryNote: '原重试请求仍无可匹配回执；未创建第二个执行意图。',
        };
      if (!retryReceiptMatches(request.intent, request.receipt))
        return {
          ...current,
          retryStatus: 'MISMATCH',
          retryNote: '回执属于其他项目/尝试或文件集合，未推进；原失败文件仍保留。',
        };
      if (current.attempts.some((attempt) => attempt.requestId === request.intent.requestId))
        return current;
      const previous = current.attempts[0];
      const files = request.intent.fileIds.flatMap((fileId) => {
        const source = previous?.files.find((file) => file.fileId === fileId);
        if (!source) return [];
        return [
          {
            ...source,
            state: 'REVIEWABLE' as const,
            versionId: source.versionId ?? 'V1',
            provenance: `恢复尝试 ${request.intent.requestId} · 仅失败文件`,
            error: undefined,
          },
        ];
      });
      const attempt: ExecutionAttempt = {
        attemptId: `U3-ATTEMPT-${String(current.attempts.length + 1).padStart(2, '0')}`,
        requestId: request.intent.requestId,
        projectId,
        planId: plan.planId,
        planVersion: plan.version,
        label: '失败文件恢复尝试',
        trigger: 'RECOVERY',
        createdAt: new Date().toISOString(),
        files,
        fixedInputs: u3ExecutionFixedInputs,
        errors: [],
        note: '只重试原失败文件；成功文件未重新生成，原尝试与错误历史保留。',
      };
      return {
        ...current,
        attempts: [...current.attempts, attempt],
        retryStatus: 'RECEIVED',
        retryNote: '原重试回执已核验；只新增失败文件的恢复尝试，成功文件保持不变。',
      };
    });
  }

  function addLate(scene: 'AFTER_BASIS_CHANGE' | 'AFTER_NEWER_ATTEMPT') {
    setExecution((current) => {
      const basisKey = `${manual?.finalizationId ?? 'NONE'}|${procedure?.finalizationId ?? 'NONE'}`;
      const newer = current.attempts.length > 1 ? current.attempts.at(-1)?.attemptId : undefined;
      const input =
        scene === 'AFTER_BASIS_CHANGE'
          ? {
              projectId,
              planId: plan.planId,
              planVersion: plan.version,
              basisKey: 'OLD-BASIS',
              currentProjectId: projectId,
              currentPlanId: plan.planId,
              currentPlanVersion: plan.version,
              currentBasisKey: basisKey,
            }
          : {
              projectId,
              planId: plan.planId,
              planVersion: plan.version,
              basisKey,
              currentProjectId: projectId,
              currentPlanId: plan.planId,
              currentPlanVersion: plan.version,
              currentBasisKey: basisKey,
              newerAttemptId: newer ?? 'U3-ATTEMPT-02',
            };
      const classification: LateResultClassification = classifyLateResult(input);
      const record: LateResultRecord & { filesLabel: string } = {
        resultId: `U3-LATE-${crypto.randomUUID().slice(0, 8)}`,
        ...(current.attempts[0] ? { attemptId: current.attempts[0].attemptId } : {}),
        projectId,
        planId: plan.planId,
        planVersion: plan.version,
        files: successfulVersions(
          current.attempts[0] ?? {
            attemptId: '',
            requestId: '',
            projectId,
            planId: plan.planId,
            planVersion: plan.version,
            label: '',
            trigger: 'INITIAL',
            createdAt: '',
            files: [],
            fixedInputs: [],
            errors: [],
            note: '',
          },
        ),
        basisKey: input.basisKey,
        arrivalScene: scene,
        disposition: classification.disposition,
        note: classification.reason,
        receivedAt: new Date().toISOString(),
        filesLabel:
          scene === 'AFTER_BASIS_CHANGE'
            ? '来源：旧手册依据下的尝试；当前依据已变化。'
            : '来源：较新尝试已存在；旧结果只保留历史。',
      };
      return { ...current, late: [...current.late, record] };
    });
  }

  function saveDraft() {
    setExecution((current) => {
      if (current.draft.text.trim().length === 0) return current;
      if (draftSaveUnresolved(current.draft))
        return {
          ...current,
          saveNote: '原保存请求仍未决；只查询原请求，不创建新的保存意图。',
        };
      return {
        ...current,
        draft: draftWhileSaving(current.draft, `U3-SAVE-${crypto.randomUUID().slice(0, 8)}`),
        saveNote: '已登记模拟保存请求；请用演练控制返回回执。',
      };
    });
  }

  function applyDraftReceipt() {
    setExecution((current) => {
      const draft = current.draft;
      if (!draftSaveUnresolved(draft) || draft.requestLabel === undefined) return current;
      const next = draftAfterSaveReceipt(draft, current.draftScene);
      const saveNote = next.note;
      if (current.draftScene !== 'SAVED' || !draft.savedText)
        return { ...current, draft: next, saveNote };
      const already = current.history.some((entry) => entry.requestLabel === draft.requestLabel);
      return {
        ...current,
        draft: next,
        saveNote,
        history: already
          ? current.history
          : [
              ...current.history,
              {
                id: `U3-OPINION-${crypto.randomUUID().slice(0, 8)}`,
                text: draft.savedText,
                status: '已保存（模拟）',
                requestLabel: draft.requestLabel,
                basis: `${plan.planId} 第 ${plan.version} 版 · 失败文件恢复批次`,
              },
            ],
      };
    });
  }

  function confirmDelivery() {
    const selection = delivery.selection;
    if (!selection || !canConfirm) return;
    const intent = deliveryIntentFromSelection(proposal, selection, {
      requestId: `U3-FINAL-${crypto.randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
    });
    if (delivery.confirmScene === 'changed') {
      u2.update('RECORDS', (current) => ({
        ...addSessionVersion(current, 'F-FORM-APPLY', u2VersionsFor('F-FORM-APPLY').at(-1) ?? 'V3'),
        message: '确认前模拟记录表单版本变化；原清单选择保留但已过期，请重新复核。',
      }));
      setDelivery((current) => ({
        ...current,
        confirmStatus: 'MISMATCH',
        confirmRequest: { intent },
        confirmNote: '确认前版本/依据已变化；未冻结。请重新复核受影响表单并显式重新核对清单。',
      }));
      return;
    }
    if (delivery.confirmScene === 'failed') {
      setDelivery((current) => ({
        ...current,
        confirmStatus: 'FAILED',
        confirmRequest: { intent },
        confirmNote: '模拟最终确认失败；原选择与上下文保留，可重新核对后再次确认。',
      }));
      return;
    }
    if (delivery.confirmScene === 'pending' || delivery.confirmScene === 'unknown') {
      setDelivery((current) => ({
        ...current,
        confirmStatus: delivery.confirmScene === 'pending' ? 'PENDING' : 'UNKNOWN',
        confirmRequest: { intent },
        confirmNote:
          delivery.confirmScene === 'pending'
            ? '确认请求待回执；重复点击不会创建第二个意图。'
            : '确认结果未知；只查询原请求。',
      }));
      return;
    }
    if (delivery.confirmScene === 'mismatch') {
      setDelivery((current) => ({
        ...current,
        confirmStatus: 'PENDING',
        confirmRequest: { intent, receipt: wrongReceipt(intent) },
        confirmNote: '模拟确认回执与清单或依据不匹配；请重新查询原请求核对。',
      }));
      return;
    }
    const receipt = exactReceipt(intent);
    setDelivery((current) => ({
      ...current,
      confirmStatus: 'DONE',
      confirmRequest: { intent, receipt },
      frozen: frozenFromIntent(intent),
      confirmNote: '清单已由一次匹配的最终确认冻结；新候选不会改变冻结清单。',
      packagingStatus: 'NONE',
      packagingNote: '确认冻结后才能打包；失败只重试同一冻结清单。',
    }));
  }

  function queryConfirmation() {
    setDelivery((current) => {
      const request = current.confirmRequest;
      if (!request) return current;
      if (!request.receipt)
        return {
          ...current,
          confirmNote: '原确认请求仍无可匹配回执；未创建第二个确认意图。',
        };
      const keyNow = deliveryListKey(proposal);
      const matches =
        deliveryReceiptMatches(request.intent, request.receipt) &&
        deliveryIntentKey(request.intent) === keyNow;
      if (!matches)
        return {
          ...current,
          confirmStatus: 'MISMATCH',
          confirmNote: '回执与当前清单、精确版本或依据不匹配；未冻结。请重新核对当前清单后再确认。',
        };
      return {
        ...current,
        confirmStatus: 'DONE',
        frozen: frozenFromIntent(request.intent),
        confirmNote: '已查询到原确认回执；未创建第二个意图。',
        packagingStatus: 'NONE',
        packagingNote: '确认冻结后才能打包；失败只重试同一冻结清单。',
      };
    });
  }

  function startPackaging() {
    const frozen = delivery.frozen;
    if (!frozen) return;
    if (delivery.packagingStatus === 'PENDING' || delivery.packagingStatus === 'UNKNOWN') return;
    const requestId = `U3-PACK-${crypto.randomUUID().slice(0, 8)}`;
    if (delivery.packagingScene === 'FAILED') {
      const attempt: PackagingAttempt = {
        requestId,
        frozenKey: frozen.frozenKey,
        projectId,
        status: 'FAILED',
        note: '模拟打包失败；未重新生成业务文档，可对同一冻结清单重试。',
        createdAt: new Date().toISOString(),
      };
      setDelivery((current) => ({
        ...current,
        packagingStatus: 'FAILED',
        packagingRequest: attempt,
        packagingNote: '打包失败；冻结清单与确认未改变，可重试同一清单。',
      }));
      return;
    }
    if (delivery.packagingScene === 'UNKNOWN') {
      const attempt: PackagingAttempt = {
        requestId,
        frozenKey: frozen.frozenKey,
        projectId,
        status: 'UNKNOWN',
        note: '模拟打包结果未知；先查询原打包请求，未核对前不开始第二次。',
        createdAt: new Date().toISOString(),
      };
      setDelivery((current) => ({
        ...current,
        packagingStatus: 'UNKNOWN',
        packagingRequest: attempt,
        packagingNote: '打包结果待核验；只查询原打包请求。',
      }));
      return;
    }
    if (delivery.packagingScene === 'MISMATCH') {
      const attempt: PackagingAttempt = {
        requestId,
        frozenKey: `${frozen.frozenKey}-OTHER`,
        projectId,
        status: 'MISMATCH',
        note: '模拟回执属于其他冻结清单；未生成包。',
        createdAt: new Date().toISOString(),
      };
      setDelivery((current) => ({
        ...current,
        packagingStatus: 'MISMATCH',
        packagingRequest: attempt,
        packagingNote: '打包回执与冻结清单不匹配；未生成包，可对同一清单重试。',
      }));
      return;
    }
    setDelivery((current) => {
      const pkg = makePackage(frozen, current.packages.length + 1);
      return {
        ...current,
        packagingStatus: 'AVAILABLE',
        packagingRequest: {
          requestId,
          frozenKey: frozen.frozenKey,
          projectId,
          status: 'AVAILABLE',
          note: '包可用；成员对应冻结精确版本。',
          createdAt: new Date().toISOString(),
          packageId: pkg.id,
        },
        packagingNote: '包已可用（模拟）；下载与客户接收分别表达。',
        packages: [...current.packages, pkg],
      };
    });
  }

  function queryPackaging() {
    setDelivery((current) => {
      if (current.packagingStatus === 'MISMATCH')
        return {
          ...current,
          packagingStatus: 'FAILED',
          packagingNote: '原打包回执与冻结清单不匹配；未生成包，可对同一清单重试。',
        };
      if (current.packagingStatus !== 'UNKNOWN') return current;
      if (!current.frozen) return current;
      const pkg = makePackage(current.frozen, current.packages.length + 1);
      return {
        ...current,
        packagingStatus: 'AVAILABLE',
        packagingRequest: {
          requestId:
            current.packagingRequest?.requestId ?? `U3-PACK-${crypto.randomUUID().slice(0, 8)}`,
          frozenKey: current.frozen.frozenKey,
          projectId,
          status: 'AVAILABLE',
          note: '原打包请求已核验；包可用。',
          createdAt: new Date().toISOString(),
          packageId: pkg.id,
        },
        packagingNote: '已核对原打包请求；未创建第二个确认，也未重新生成业务文档。',
        packages: [...current.packages, pkg],
      };
    });
  }

  function downloadPackage(pkg: DeliveryPackage) {
    const at = new Date().toISOString();
    const fact = (state: DownloadFact['state'], note: string, id: string): DownloadFact => ({
      id,
      packageId: pkg.id,
      at,
      state,
      note,
    });
    const requestId = `U3-DOWNLOAD-${crypto.randomUUID().slice(0, 8)}`;
    appendDownload(pkg.id, fact('REQUESTED', '已请求下载；保存结果尚不可知。', requestId));
    if (delivery.downloadScene === 'FAILED') {
      appendDownload(
        pkg.id,
        fact('FAILED', '模拟下载响应失败或中断；未声称保存成功。', `${requestId}-FAIL`),
      );
      return;
    }
    if (delivery.downloadScene === 'UNKNOWN') {
      appendDownload(
        pkg.id,
        fact('UNKNOWN', '模拟下载结果待核实；不按时间推断保存成功。', `${requestId}-UNKNOWN`),
      );
      return;
    }
    const bytes = syntheticZip(pkg.frozen);
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/zip' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${pkg.id}-SYNTHETIC.zip`;
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    appendDownload(
      pkg.id,
      fact(
        'RESPONSE_SENT',
        '浏览器已开始保存响应；不表示客户已收到或项目完成。',
        `${requestId}-SENT`,
      ),
    );
  }

  function appendDownload(packageId: string, download: DownloadFact) {
    setDelivery((current) => ({
      ...current,
      packages: current.packages.map((pkg) =>
        pkg.id === packageId ? { ...pkg, downloads: [...pkg.downloads, download] } : pkg,
      ),
    }));
  }

  function simulateRecordRevision() {
    u2.update('RECORDS', (current) => ({
      ...addSessionVersion(current, 'F-FORM-APPLY', u2VersionsFor('F-FORM-APPLY').at(-1) ?? 'V3'),
      message: '模拟记录表单后续改稿已到达；既有冻结包不变，本次复核与待交付清单需重新核对。',
    }));
    setDelivery((current) => ({
      ...current,
      note: '记录表单出现后续改稿；历史包不变，新一轮交付需重新复核与确认。',
    }));
  }

  function startNewRound() {
    setDelivery((current) => ({
      ...current,
      frozen: undefined,
      selection: undefined,
      confirmStatus: 'NONE',
      confirmRequest: undefined,
      confirmNote: '已开始新一轮最终交付确认；历史包保留且不会被改写。',
      packagingStatus: 'NONE',
      packagingRequest: undefined,
      packagingNote: '新一轮确认冻结后才能打包。',
      note: '新一轮确认不会改变历史包成员或字节。',
    }));
  }

  function exactReceipt(intent: DeliveryIntent): DeliveryReceipt {
    return {
      classification: 'DEVELOPMENT_FIXTURE_ONLY',
      requestId: intent.requestId,
      proposalKey: deliveryIntentKey(intent),
      members: intent.members.map((member) => ({ ...member })),
      packageRequestId: `U3-PACKAGE-${crypto.randomUUID().slice(0, 8)}`,
      confirmedAt: new Date().toISOString(),
    };
  }

  function wrongReceipt(intent: DeliveryIntent): DeliveryReceipt {
    return {
      ...exactReceipt(intent),
      members: intent.members.map((member, index) =>
        index === 0 ? { ...member, versionId: `${member.versionId}-MISMATCH` } : member,
      ),
    };
  }
}

function deliveryBlockersIssues(
  selection: DeliverySelection,
  proposal: DeliveryProposal,
  requiredFileIds: readonly string[],
): SelectionIssues {
  const selected = new Map(selection.members.map((member) => [member.fileId, member]));
  const missingRequired = requiredFileIds.filter((fileId) => !selected.has(fileId));
  const stale = selection.members
    .filter((member) => {
      const current = proposal.members.find((entry) => entry.fileId === member.fileId);
      return current?.versionId !== member.versionId || current.content !== member.content;
    })
    .map((member) => member.fileId);
  if (selection.proposalKey !== deliveryListKey(proposal) && stale.length === 0)
    return { missingRequired, stale: proposal.members.map((member) => member.fileId) };
  return { missingRequired, stale };
}

function makePackage(frozen: FrozenDelivery, index: number): DeliveryPackage {
  return {
    id: `U3-PKG-${String(index).padStart(2, '0')}`,
    label: `演练交付包 ${index}`,
    createdAt: new Date().toISOString(),
    frozen,
    availability: 'AVAILABLE',
    reason: '合成演练包；成员名称与正文对应冻结精确版本，不含客户原件或正式模板正文。',
    synthetic: true,
    downloads: [],
  };
}

function buildHandoff(input: {
  reviewStages: readonly JourneyReviewStage[];
  planCheck: { ready: boolean; reason?: string | undefined };
  unconfirmedNext: { label: string; href: string; reason: string };
  manual:
    { finalizationId: string; files: readonly { fileId: string; versionId: string }[] } | undefined;
  procedure:
    | {
        finalizationId: string;
        manualFinalizationId?: string | undefined;
        files: readonly { fileId: string; versionId: string }[];
      }
    | undefined;
  procedureImpact: boolean;
  recordsReviewed: boolean;
  recordsImpact: boolean;
  deliveryFrozen: boolean;
}): MvpHandoff {
  const planReady = input.planCheck.ready;
  const manualDone = Boolean(input.manual);
  const procedureDone = Boolean(
    input.procedure &&
    input.manual &&
    input.procedure.manualFinalizationId === input.manual.finalizationId,
  );
  const recordsDone = input.recordsReviewed;
  const next = !input.planCheck.ready
    ? input.unconfirmedNext
    : !manualDone
      ? {
          label: '进入质量手册审阅',
          href: manualPath,
          reason: '范围已确认；下一步审阅质量手册候选并模拟定稿一个精确版本。',
        }
      : !procedureDone
        ? {
            label: input.procedureImpact ? '复核第二阶段完整集合' : '进入程序与制度审阅',
            href: proceduresPath,
            reason: input.procedureImpact
              ? '质量手册已重新定稿；第二阶段需按新依据重新确认完整集合。'
              : '质量手册已有模拟定稿；下一步联动审阅控制程序与管理制度。',
          }
        : !recordsDone
          ? {
              label: '复核记录表单',
              href: recordsPath,
              reason: input.recordsImpact
                ? '第二阶段依据已变化；记录表单需重新核对受影响精确版本。'
                : '记录表单最终交付前需完成受影响复核。',
            }
          : !input.deliveryFrozen
            ? {
                label: '确认最终交付清单',
                href: deliveryPath,
                reason: '两项上游依据与记录表单复核已就绪；最终交付仍需一次显式确认。',
              }
            : {
                label: '查看最终交付包',
                href: deliveryPath,
                reason: '清单已冻结；可查看打包、下载与历史包。',
              };
  return {
    reviewStages: input.reviewStages,
    next,
    stages: [
      {
        id: 'manual',
        label: '质量手册',
        state: !planReady ? '未开始' : manualDone ? '已定稿（模拟）' : '待审阅（演示）',
        detail: !planReady
          ? '确认范围后可进入质量手册审阅。'
          : manualDone
            ? `模拟定稿 ${input.manual?.finalizationId ?? ''} 已绑定精确手册版本。`
            : '已确认计划可进入质量手册候选审阅与模拟定稿。',
      },
      {
        id: 'procedures',
        label: '控制程序与管理制度',
        state: !planReady
          ? '未开始'
          : procedureDone
            ? '已定稿（模拟）'
            : input.procedureImpact
              ? '依据已变化，待复核'
              : manualDone
                ? '待审阅（演示）'
                : '等待手册定稿',
        detail: !planReady
          ? '确认范围后以质量手册定稿为依据。'
          : procedureDone
            ? `模拟定稿 ${input.procedure?.finalizationId ?? ''} 已绑定当前手册依据。`
            : input.procedureImpact
              ? '质量手册重新定稿；本阶段旧集合保留但需重新确认完整版本集合。'
              : '以质量手册的精确模拟定稿为依据，两类文件同轮审阅并整体确认。',
      },
      {
        id: 'records',
        label: '记录表单与交付',
        state: !planReady
          ? '未开始'
          : recordsDone
            ? '已复核（模拟）'
            : procedureDone
              ? '待复核（演示）'
              : '等待第二阶段定稿',
        detail: !planReady
          ? '确认范围并完成前两阶段后进入记录表单复核。'
          : recordsDone
            ? '记录表单已复核到精确版本；最终交付清单仍需一次显式确认。'
            : '记录表单复核只绑定精确版本，不是定稿关卡；最终交付属于 U3。',
      },
    ],
    u3Stages: [
      {
        id: 'rework',
        label: '返工与复核',
        href: reworkPath,
        ready: input.planCheck.ready,
        reason: input.planCheck.reason,
      },
      {
        id: 'recovery',
        label: '执行与恢复',
        href: recoveryPath,
        ready: input.planCheck.ready,
        reason: input.planCheck.reason,
      },
      {
        id: 'delivery',
        label: '最终交付',
        href: deliveryPath,
        ready: input.planCheck.ready,
        reason: input.planCheck.reason,
      },
    ],
  };
}

function useU3(): U3Api {
  const value = useContext(U3Context);
  if (!value) throw new Error('DEVELOPMENT_U3_ADAPTER_ONLY');
  return value;
}

export function FixtureU3Rework() {
  const params = useParams();
  const u3 = useU3();
  if (params.projectId !== projectId) return <Missing />;
  return <ReworkPage {...u3.rework} />;
}

export function FixtureU3Recovery() {
  const params = useParams();
  const u3 = useU3();
  if (params.projectId !== projectId) return <Missing />;
  return <RecoveryPage {...u3.execution} />;
}

export function FixtureU3Delivery() {
  const params = useParams();
  const u3 = useU3();
  if (params.projectId !== projectId) return <Missing />;
  return <DeliveryFlowPage {...u3.delivery} />;
}

/** Legacy synthetic delivery remains available for its own project only. */
export function FixtureMvpDeliveryRoute() {
  const params = useParams();
  if (params.projectId === projectId) return <FixtureU3Delivery />;
  if (params.projectId === 'DEMO-PROJECT-01') return <FixtureDelivery />;
  return <Missing />;
}
