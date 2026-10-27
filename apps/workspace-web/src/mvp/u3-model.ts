// Experience presentation model for the U3 rework, recovery and delivery
// rehearsal. These types are page-local view state; they are not public wire
// contracts, server receipts, persistence records or Runner results.
import type { MarkdownReviewData } from '../MarkdownReviewPage.js';
import type { FileVersionRef, MvpStageId, StageFinalization } from './review-model.js';

export interface ReworkFileImpact {
  fileId: string;
  title: string;
  stage: MvpStageId;
  action: 'REVISE' | 'RETAIN';
  reason: string;
}

export interface ReworkBasisChange {
  source: 'MANUAL' | 'PROCEDURES';
  previousBasisId: string;
  newBasisId: string;
}

export interface ReworkImpact {
  changes: readonly ReworkBasisChange[];
  stages: readonly MvpStageId[];
  files: readonly ReworkFileImpact[];
  note: string;
}

function versionRefKey(files: readonly FileVersionRef[]): string {
  return [...files]
    .sort((left, right) => left.fileId.localeCompare(right.fileId))
    .map((file) => `${file.fileId}@${file.versionId}`)
    .join('|');
}

export interface DeliveryMember {
  fileId: string;
  title: string;
  stage: MvpStageId;
  versionId: string;
  versionLabel: string;
  /** Exact public-safe rehearsal Markdown for this version. */
  content: string;
}

export interface DeliveryProposal {
  projectId: string;
  planId: string;
  planVersion: number;
  manualFinalizationId?: string | undefined;
  procedureFinalizationId?: string | undefined;
  rulesFinalizationId?: string | undefined;
  members: readonly DeliveryMember[];
}

export function deliveryListKey(proposal: DeliveryProposal): string {
  return JSON.stringify([
    proposal.projectId,
    proposal.planId,
    proposal.planVersion,
    proposal.manualFinalizationId ?? '',
    proposal.procedureFinalizationId ?? '',
    proposal.rulesFinalizationId ?? '',
    proposal.members.map((member) => [
      member.fileId,
      member.versionId,
      member.stage,
      member.content,
    ]),
  ]);
}

export function sameDeliveryList(left: DeliveryProposal, right: DeliveryProposal): boolean {
  return deliveryListKey(left) === deliveryListKey(right);
}

export interface DeliverySelection {
  proposalKey: string;
  members: readonly DeliveryMember[];
}

export interface SelectionIssues {
  missingRequired: readonly string[];
  stale: readonly string[];
}

/**
 * Compares a preserved selection with the current proposed list. A version,
 * basis or membership change marks the selection stale instead of silently
 * confirming the new list.
 */
export function selectionIssues(
  selection: DeliverySelection | undefined,
  proposal: DeliveryProposal,
  requiredFileIds: readonly string[],
): SelectionIssues {
  if (!selection) return { missingRequired: [...requiredFileIds], stale: [] };
  const selected = new Map(selection.members.map((member) => [member.fileId, member]));
  const current = new Map(proposal.members.map((member) => [member.fileId, member]));
  const missingRequired = requiredFileIds.filter((fileId) => !selected.has(fileId));
  const stale = [
    ...new Set(
      selection.members
        .filter((member) => current.get(member.fileId)?.versionId !== member.versionId)
        .map((member) => member.fileId),
    ),
  ];
  if (selection.proposalKey !== deliveryListKey(proposal) && stale.length === 0) {
    // A basis/identity/content change without a version change still requires rechecking.
    return { missingRequired, stale: proposal.members.map((member) => member.fileId) };
  }
  return { missingRequired, stale };
}

export interface DeliveryBlockerInput {
  planReady: boolean;
  planReason?: string | undefined;
  manual?: StageFinalization | undefined;
  procedures?: StageFinalization | undefined;
  rules?: StageFinalization | undefined;
  manualExpectedFiles: readonly string[];
  procedureExpectedFiles: readonly string[];
  ruleExpectedFiles: readonly string[];
  activeSubmission?: string | undefined;
  unresolvedRecovery?: string | undefined;
  selection: SelectionIssues;
}

export function deliveryBlockers(input: DeliveryBlockerInput): string[] {
  const blockers: string[] = [];
  if (!input.planReady)
    blockers.push(input.planReason ?? '修改范围尚未确认；不能确认最终交付清单。');
  if (!input.manual) blockers.push('尚无质量手册模拟定稿；不能形成最终交付依据。');
  else {
    const present = new Set(input.manual.files.map((file) => file.fileId));
    const missing = input.manualExpectedFiles.filter((fileId) => !present.has(fileId));
    if (missing.length > 0) blockers.push(`质量手册定稿缺少文件：${missing.join('、')}。`);
  }
  if (!input.procedures) blockers.push('尚无控制程序完整集合模拟定稿；不能确认最终交付。');
  else {
    const present = new Set(input.procedures.files.map((file) => file.fileId));
    const missing = input.procedureExpectedFiles.filter((fileId) => !present.has(fileId));
    if (missing.length > 0) blockers.push(`控制程序定稿缺少文件：${missing.join('、')}。`);
    if (input.manual && input.procedures.manualFinalizationId !== input.manual.finalizationId)
      blockers.push('控制程序集合仍以旧质量手册为依据；请先按当前手册重新确认完整集合。');
  }
  if (!input.rules) blockers.push('尚无管理制度及记录表单完整集合模拟定稿；不能确认最终交付。');
  else {
    if (
      (input.manual && input.rules.manualFinalizationId !== input.manual.finalizationId) ||
      (input.procedures && input.rules.procedureFinalizationId !== input.procedures.finalizationId)
    )
      blockers.push('第三阶段定稿依据已变化；请按当前上游定稿重新确认完整集合。');
    const present = new Set(input.rules.files.map((file) => file.fileId));
    const missing = input.ruleExpectedFiles.filter((fileId) => !present.has(fileId));
    if (missing.length > 0) blockers.push(`第三阶段定稿缺少文件：${missing.join('、')}。`);
  }
  if (input.activeSubmission)
    blockers.push(`仍有待回执或待核验的修改请求 ${input.activeSubmission}；不能确认最终交付。`);
  if (input.unresolvedRecovery)
    blockers.push(`仍有待回执或待核验的恢复请求 ${input.unresolvedRecovery}；不能确认最终交付。`);
  if (input.selection.missingRequired.length > 0)
    blockers.push(`最终清单缺少必需文件：${input.selection.missingRequired.join('、')}。`);
  if (input.selection.stale.length > 0)
    blockers.push(
      `所选版本或依据已变化（${input.selection.stale.join('、')}）；请显式重新核对当前清单。`,
    );
  return [...new Set(blockers)];
}

export interface DeliveryIntent {
  requestId: string;
  projectId: string;
  planId: string;
  planVersion: number;
  manualFinalizationId?: string | undefined;
  procedureFinalizationId?: string | undefined;
  rulesFinalizationId?: string | undefined;
  members: readonly DeliveryMember[];
  createdAt: string;
}

export function deliveryIntentFromSelection(
  proposal: DeliveryProposal,
  selection: DeliverySelection,
  input: { requestId: string; createdAt: string },
): DeliveryIntent {
  return {
    requestId: input.requestId,
    projectId: proposal.projectId,
    planId: proposal.planId,
    planVersion: proposal.planVersion,
    ...(proposal.manualFinalizationId !== undefined
      ? { manualFinalizationId: proposal.manualFinalizationId }
      : {}),
    ...(proposal.procedureFinalizationId !== undefined
      ? { procedureFinalizationId: proposal.procedureFinalizationId }
      : {}),
    ...(proposal.rulesFinalizationId !== undefined
      ? { rulesFinalizationId: proposal.rulesFinalizationId }
      : {}),
    members: selection.members.map((member) => ({ ...member })),
    createdAt: input.createdAt,
  };
}

export interface DeliveryReceipt {
  classification: 'DEVELOPMENT_FIXTURE_ONLY';
  requestId: string;
  proposalKey: string;
  members: readonly DeliveryMember[];
  packageRequestId: string;
  confirmedAt: string;
}

export function deliveryIntentKey(intent: DeliveryIntent): string {
  return deliveryListKey({
    projectId: intent.projectId,
    planId: intent.planId,
    planVersion: intent.planVersion,
    ...(intent.manualFinalizationId !== undefined
      ? { manualFinalizationId: intent.manualFinalizationId }
      : {}),
    ...(intent.procedureFinalizationId !== undefined
      ? { procedureFinalizationId: intent.procedureFinalizationId }
      : {}),
    ...(intent.rulesFinalizationId !== undefined
      ? { rulesFinalizationId: intent.rulesFinalizationId }
      : {}),
    members: intent.members,
  });
}

export function deliveryReceiptMatches(intent: DeliveryIntent, receipt: DeliveryReceipt): boolean {
  if (
    intent.requestId !== receipt.requestId ||
    deliveryIntentKey(intent) !== receipt.proposalKey ||
    intent.members.length !== receipt.members.length
  )
    return false;
  return intent.members.every((member) =>
    receipt.members.some(
      (entry) =>
        entry.fileId === member.fileId &&
        entry.versionId === member.versionId &&
        entry.stage === member.stage &&
        entry.content === member.content,
    ),
  );
}

export interface FrozenDelivery {
  frozenKey: string;
  projectId: string;
  planId: string;
  planVersion: number;
  manualFinalizationId?: string | undefined;
  procedureFinalizationId?: string | undefined;
  rulesFinalizationId?: string | undefined;
  members: readonly DeliveryMember[];
  frozenAt: string;
}

export function frozenFromIntent(intent: DeliveryIntent): FrozenDelivery {
  return {
    frozenKey: deliveryIntentKey(intent),
    projectId: intent.projectId,
    planId: intent.planId,
    planVersion: intent.planVersion,
    ...(intent.manualFinalizationId !== undefined
      ? { manualFinalizationId: intent.manualFinalizationId }
      : {}),
    ...(intent.procedureFinalizationId !== undefined
      ? { procedureFinalizationId: intent.procedureFinalizationId }
      : {}),
    ...(intent.rulesFinalizationId !== undefined
      ? { rulesFinalizationId: intent.rulesFinalizationId }
      : {}),
    members: intent.members.map((member) => ({ ...member })),
    frozenAt: intent.createdAt,
  };
}

export function sameFrozenDelivery(left: FrozenDelivery, right: FrozenDelivery): boolean {
  return (
    left.frozenKey === right.frozenKey &&
    left.members.length === right.members.length &&
    left.members.every((member) =>
      right.members.some(
        (entry) =>
          entry.fileId === member.fileId &&
          entry.versionId === member.versionId &&
          entry.content === member.content,
      ),
    )
  );
}

export type PackagingStatus = 'NONE' | 'PENDING' | 'UNKNOWN' | 'FAILED' | 'MISMATCH' | 'AVAILABLE';

export interface PackagingAttempt {
  requestId: string;
  frozenKey: string;
  projectId: string;
  status: PackagingStatus;
  note: string;
  createdAt: string;
  packageId?: string | undefined;
}

export type DownloadState = 'REQUESTED' | 'RESPONSE_SENT' | 'FAILED' | 'UNKNOWN';

export const downloadStateLabels: Record<DownloadState, string> = {
  REQUESTED: '已请求下载，保存情况未知',
  RESPONSE_SENT: '浏览器已收到并开始保存响应；不表示客户已收到',
  FAILED: '下载响应失败或中断',
  UNKNOWN: '下载结果待核实',
};

export interface DownloadFact {
  id: string;
  packageId: string;
  at: string;
  state: DownloadState;
  note: string;
}

export interface DeliveryPackage {
  id: string;
  label: string;
  createdAt: string;
  frozen: FrozenDelivery;
  availability: 'AVAILABLE' | 'FAILED';
  reason: string;
  synthetic: true;
  downloads: readonly DownloadFact[];
}

export function packageMatchesFrozen(pkg: DeliveryPackage, frozen: FrozenDelivery): boolean {
  return sameFrozenDelivery(pkg.frozen, frozen);
}

export function packagingAttemptMatches(
  attempt: PackagingAttempt,
  frozen: FrozenDelivery,
): boolean {
  return (
    attempt.projectId === frozen.projectId &&
    attempt.frozenKey === frozen.frozenKey &&
    attempt.requestId.length > 0
  );
}

export type ExecutionFileState =
  'WAITING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'REVIEWABLE' | 'STALE';

export const executionStateLabels: Record<ExecutionFileState, string> = {
  WAITING: '等待安排',
  PROCESSING: '正在处理',
  SUCCEEDED: '已生成候选',
  FAILED: '已知失败',
  UNKNOWN: '结果待核验',
  REVIEWABLE: '结果可审阅',
  STALE: '结果已过期（仅保留历史）',
};

export interface ExecutionFileObservation {
  fileId: string;
  title: string;
  stage: MvpStageId;
  state: ExecutionFileState;
  versionId?: string | undefined;
  error?: string | undefined;
  provenance: string;
  linkedCorrection?: { versionId: string; reason: string } | undefined;
}

export interface ExecutionAttempt {
  attemptId: string;
  requestId: string;
  projectId: string;
  planId: string;
  planVersion: number;
  label: string;
  trigger: 'INITIAL' | 'RECOVERY';
  createdAt: string;
  files: readonly ExecutionFileObservation[];
  fixedInputs: readonly string[];
  errors: readonly string[];
  note: string;
}

export type AttemptOutcome = 'RUNNING' | 'PARTIAL' | 'FAILED' | 'COMPLETE' | 'UNKNOWN';

export function attemptOutcome(attempt: ExecutionAttempt): AttemptOutcome {
  if (attempt.files.some((file) => file.state === 'UNKNOWN')) return 'UNKNOWN';
  const failed = attempt.files.filter((file) => file.state === 'FAILED' || file.state === 'STALE');
  const succeeded = attempt.files.filter(
    (file) => file.state === 'SUCCEEDED' || file.state === 'REVIEWABLE',
  );
  if (failed.length > 0 && succeeded.length > 0) return 'PARTIAL';
  if (failed.length > 0) return 'FAILED';
  if (attempt.files.some((file) => file.state === 'PROCESSING' || file.state === 'WAITING'))
    return 'RUNNING';
  return 'COMPLETE';
}

/** Only known failures are retryable; UNKNOWN must reconcile its original attempt first. */
export function retryableFiles(attempt: ExecutionAttempt): ExecutionFileObservation[] {
  return attempt.files.filter((file) => file.state === 'FAILED');
}

export interface RetryIntent {
  requestId: string;
  attemptId: string;
  projectId: string;
  planId: string;
  planVersion: number;
  fileIds: readonly string[];
}

export function retryIntentFor(
  attempt: ExecutionAttempt,
  requestId: string,
): RetryIntent | undefined {
  const failed = retryableFiles(attempt);
  if (failed.length === 0) return undefined;
  return {
    requestId,
    attemptId: attempt.attemptId,
    projectId: attempt.projectId,
    planId: attempt.planId,
    planVersion: attempt.planVersion,
    fileIds: failed.map((file) => file.fileId),
  };
}

export interface RetryReceipt {
  classification: 'DEVELOPMENT_FIXTURE_ONLY';
  requestId: string;
  attemptId: string;
  projectId: string;
  planId: string;
  planVersion: number;
  fileIds: readonly string[];
  status: 'PENDING' | 'ACCEPTED' | 'UNKNOWN' | 'FAILED';
}

export function retryReceiptMatches(intent: RetryIntent, receipt: RetryReceipt): boolean {
  return (
    intent.requestId === receipt.requestId &&
    intent.attemptId === receipt.attemptId &&
    intent.projectId === receipt.projectId &&
    intent.planId === receipt.planId &&
    intent.planVersion === receipt.planVersion &&
    versionRefKey(intent.fileIds.map((fileId) => ({ fileId, versionId: '' }))) ===
      versionRefKey(receipt.fileIds.map((fileId) => ({ fileId, versionId: '' })))
  );
}

export function successfulVersions(attempt: ExecutionAttempt): FileVersionRef[] {
  return attempt.files
    .filter((file) => (file.state === 'SUCCEEDED' || file.state === 'REVIEWABLE') && file.versionId)
    .map((file) => ({ fileId: file.fileId, versionId: file.versionId ?? '' }));
}

export interface LateResultRecord {
  resultId: string;
  attemptId?: string | undefined;
  projectId: string;
  planId: string;
  planVersion: number;
  files: readonly FileVersionRef[];
  basisKey: string;
  arrivalScene: 'AFTER_BASIS_CHANGE' | 'AFTER_NEWER_ATTEMPT';
  disposition: 'ACCEPT' | 'HISTORY_ONLY';
  note: string;
  receivedAt: string;
}

export interface LateResultInput {
  projectId: string;
  planId: string;
  planVersion: number;
  basisKey: string;
  currentProjectId: string;
  currentPlanId: string;
  currentPlanVersion: number;
  currentBasisKey: string;
  newerAttemptId?: string | undefined;
}

export interface LateResultClassification {
  disposition: 'ACCEPT' | 'HISTORY_ONLY';
  reason: string;
}

/**
 * A late result can only advance the journey when its project, plan, exact
 * version context and upstream basis still match. Otherwise its provenance is
 * retained as history and it cannot replace accepted versions, readings,
 * drafts or finalizations.
 */
export function classifyLateResult(input: LateResultInput): LateResultClassification {
  if (
    input.projectId !== input.currentProjectId ||
    input.planId !== input.currentPlanId ||
    input.planVersion !== input.currentPlanVersion
  )
    return {
      disposition: 'HISTORY_ONLY',
      reason: '结果属于其他项目、计划或版本；只保留来源与历史，不推进当前旅程。',
    };
  if (input.newerAttemptId)
    return {
      disposition: 'HISTORY_ONLY',
      reason: `较新尝试 ${input.newerAttemptId} 已存在；旧结果只保留历史，不替换当前版本。`,
    };
  if (input.basisKey !== input.currentBasisKey)
    return {
      disposition: 'HISTORY_ONLY',
      reason: '结果到达时上游依据已变化；只保留来源与历史，不替换当前阅读、草稿或定稿。',
    };
  return { disposition: 'ACCEPT', reason: '结果与当前项目、计划和依据匹配，可进入审阅。' };
}

/** Deterministic Markdown for one exact candidate; used by rehearsal ZIP members. */
export function candidateMarkdown(data: MarkdownReviewData): string {
  const units = new Map(data.content.document.units.map((unit) => [unit.unitId, unit]));
  const lines: string[] = [];
  const render = (unitId: string): void => {
    const unit = units.get(unitId);
    if (!unit) return;
    if (unit.unitType === 'SECTION') {
      lines.push(`# ${unit.text ?? ''}`, '');
      for (const childId of unit.childUnitIds) render(childId);
      return;
    }
    if (unit.unitType === 'PARAGRAPH') {
      lines.push(unit.text ?? '', '');
      return;
    }
    if (unit.unitType === 'TABLE') {
      const rows = unit.childUnitIds
        .map((rowId) => units.get(rowId))
        .filter((row) => row !== undefined)
        .map((row) => row.childUnitIds.map((cellId) => units.get(cellId)?.text ?? '').join(' | '));
      if (rows.length > 0) {
        const [header, ...body] = rows;
        lines.push(`| ${header ?? ''} |`);
        const columns = rows[0]?.split(' | ').length ?? 0;
        lines.push(`| ${Array.from({ length: columns }, () => '---').join(' | ')} |`);
        for (const row of body) lines.push(`| ${row} |`);
        lines.push('');
      }
    }
  };
  for (const unit of data.content.document.units.filter((entry) => entry.unitType === 'SECTION'))
    render(unit.unitId);
  return lines.join('\n').trim() + '\n';
}
