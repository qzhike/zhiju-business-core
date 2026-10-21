// Experience presentation model for the U2 three-stage review rehearsal.
// These types are page-local view state; they are not public wire contracts,
// server receipts, business eligibility rules or persistence records.

export type MvpStageId = 'MANUAL' | 'PROCEDURES' | 'RECORDS';

export const mvpStageLabels: Record<MvpStageId, string> = {
  MANUAL: '质量手册',
  PROCEDURES: '控制程序与管理制度',
  RECORDS: '记录表单',
};

/** The plan facts the review journey is allowed to bind to. */
export interface PlanBinding {
  planId: string;
  version: number;
  state: string;
  supersededBy?: string | undefined;
  receiptMatches: boolean;
  inputRefs: readonly string[];
  templateIds: readonly string[];
}

export function planReady(plan: PlanBinding): { ready: boolean; reason?: string } {
  if (plan.supersededBy)
    return { ready: false, reason: '当前计划已被新计划替代；请先在修改范围页核对并确认当前版本。' };
  if (plan.state !== 'CONFIRMED')
    return { ready: false, reason: '修改范围尚未确认；未确认的计划不能启动模拟生成或阶段定稿。' };
  if (!plan.receiptMatches)
    return { ready: false, reason: '模拟确认回执与当前计划不匹配，不能作为审阅依据。' };
  return { ready: true };
}

export interface FileVersionRef {
  fileId: string;
  versionId: string;
}

export function versionKey(files: readonly FileVersionRef[]): string {
  return [...files]
    .sort((left, right) => left.fileId.localeCompare(right.fileId))
    .map((file) => `${file.fileId}@${file.versionId}`)
    .join('|');
}

/** Exact set comparison: same members, same exact versions, no extras. */
export function sameVersionSet(
  left: readonly FileVersionRef[],
  right: readonly FileVersionRef[],
): boolean {
  return versionKey(left) === versionKey(right);
}

export function duplicateFileIds(files: readonly FileVersionRef[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const file of files) {
    if (seen.has(file.fileId)) duplicates.add(file.fileId);
    seen.add(file.fileId);
  }
  return [...duplicates];
}

/** Expected files that have no exact version in the supplied set. */
export function missingVersionFiles(
  expectedFileIds: readonly string[],
  files: readonly FileVersionRef[],
): string[] {
  const present = new Set(files.map((file) => file.fileId));
  return expectedFileIds.filter((fileId) => !present.has(fileId));
}

export function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const normalize = (values: readonly string[]) =>
    [...new Set(values)].sort((a, b) => a.localeCompare(b)).join('|');
  return normalize(left) === normalize(right);
}

export type FinalizationStage = Extract<MvpStageId, 'MANUAL' | 'PROCEDURES'>;

export interface FinalizationBasis {
  projectId: string;
  stage: FinalizationStage;
  planId: string;
  planVersion: number;
  inputRefs: readonly string[];
  templateIds: readonly string[];
  manualFinalizationId?: string | undefined;
}

export interface StageFinalization extends FinalizationBasis {
  classification: 'DEVELOPMENT_FIXTURE_ONLY';
  finalizationId: string;
  files: readonly FileVersionRef[];
  confirmedAt: string;
}

export function finalizationMatchesBasis(
  finalization: StageFinalization,
  basis: FinalizationBasis,
): boolean {
  return (
    finalization.projectId === basis.projectId &&
    finalization.stage === basis.stage &&
    finalization.planId === basis.planId &&
    finalization.planVersion === basis.planVersion &&
    finalization.manualFinalizationId === basis.manualFinalizationId &&
    sameStringSet(finalization.inputRefs, basis.inputRefs) &&
    sameStringSet(finalization.templateIds, basis.templateIds)
  );
}

export interface UpstreamCheck {
  ok: boolean;
  reason?: string;
}

/**
 * The second stage runs against one exact finalized manual. A later manual
 * candidate does not silently replace that basis; re-finalizing upstream is U3.
 */
export function manualBasis(
  finalization: StageFinalization | undefined,
  expected: {
    projectId: string;
    planId: string;
    planVersion: number;
    inputRefs: readonly string[];
    templateIds: readonly string[];
    manualFileIds: readonly string[];
  },
): UpstreamCheck {
  if (!finalization) return { ok: false, reason: '尚无质量手册模拟定稿；第二阶段不能开始。' };
  if (finalization.stage !== 'MANUAL') return { ok: false, reason: '上游依据不是质量手册定稿。' };
  if (
    !finalizationMatchesBasis(finalization, {
      projectId: expected.projectId,
      stage: 'MANUAL',
      planId: expected.planId,
      planVersion: expected.planVersion,
      inputRefs: expected.inputRefs,
      templateIds: expected.templateIds,
    })
  )
    return { ok: false, reason: '质量手册定稿与当前项目或计划不匹配。' };
  const finalFiles = finalization.files.map((file) => file.fileId);
  if (
    finalFiles.length !== expected.manualFileIds.length ||
    finalFiles.some((fileId) => !expected.manualFileIds.includes(fileId))
  )
    return { ok: false, reason: '质量手册定稿的文件集合与本计划不一致。' };
  return { ok: true };
}

export function procedureBasis(
  finalization: StageFinalization | undefined,
  expected: {
    projectId: string;
    planId: string;
    planVersion: number;
    inputRefs: readonly string[];
    templateIds: readonly string[];
    manualFinalizationId: string | undefined;
    procedureFileIds: readonly string[];
  },
): UpstreamCheck {
  if (!finalization) return { ok: false, reason: '尚无第二阶段模拟定稿；记录表单不能进入审阅。' };
  if (finalization.stage !== 'PROCEDURES')
    return { ok: false, reason: '上游依据不是第二阶段定稿。' };
  if (
    !expected.manualFinalizationId ||
    finalization.manualFinalizationId !== expected.manualFinalizationId
  )
    return { ok: false, reason: '第二阶段定稿绑定的质量手册版本与当前上游不一致。' };
  if (
    !finalizationMatchesBasis(finalization, {
      projectId: expected.projectId,
      stage: 'PROCEDURES',
      planId: expected.planId,
      planVersion: expected.planVersion,
      inputRefs: expected.inputRefs,
      templateIds: expected.templateIds,
      manualFinalizationId: expected.manualFinalizationId,
    })
  )
    return { ok: false, reason: '第二阶段定稿与当前项目、计划或依据不匹配。' };
  const finalFiles = finalization.files.map((file) => file.fileId);
  if (
    finalFiles.length !== expected.procedureFileIds.length ||
    finalFiles.some((fileId) => !expected.procedureFileIds.includes(fileId))
  )
    return { ok: false, reason: '第二阶段定稿的完整版本集合与本计划不一致。' };
  return { ok: true };
}

export interface FinalizationIntent extends FinalizationBasis {
  requestId: string;
  files: readonly FileVersionRef[];
}

export interface FinalizationReceipt extends FinalizationBasis {
  classification: 'DEVELOPMENT_FIXTURE_ONLY';
  requestId: string;
  files: readonly FileVersionRef[];
  finalizationId: string;
  confirmedAt: string;
}

export function finalizationIntentMatchesReceipt(
  intent: FinalizationIntent,
  receipt: FinalizationReceipt,
): boolean {
  return (
    intent.requestId === receipt.requestId &&
    intent.projectId === receipt.projectId &&
    intent.stage === receipt.stage &&
    intent.planId === receipt.planId &&
    intent.planVersion === receipt.planVersion &&
    intent.manualFinalizationId === receipt.manualFinalizationId &&
    sameVersionSet(intent.files, receipt.files) &&
    sameStringSet(intent.inputRefs, receipt.inputRefs) &&
    sameStringSet(intent.templateIds, receipt.templateIds)
  );
}

export function finalizationFromReceipt(receipt: FinalizationReceipt): StageFinalization {
  return {
    classification: 'DEVELOPMENT_FIXTURE_ONLY',
    finalizationId: receipt.finalizationId,
    projectId: receipt.projectId,
    stage: receipt.stage,
    planId: receipt.planId,
    planVersion: receipt.planVersion,
    files: receipt.files,
    ...(receipt.manualFinalizationId !== undefined
      ? { manualFinalizationId: receipt.manualFinalizationId }
      : {}),
    inputRefs: receipt.inputRefs,
    templateIds: receipt.templateIds,
    confirmedAt: receipt.confirmedAt,
  };
}

export interface FinalizationEvaluation {
  ok: boolean;
  reason?: string;
}

export function evaluateFinalizationReceipt(input: {
  intent: FinalizationIntent;
  receipt: FinalizationReceipt;
  currentFiles: readonly FileVersionRef[];
  currentManualFinalizationId?: string | undefined;
}): FinalizationEvaluation {
  if (!finalizationIntentMatchesReceipt(input.intent, input.receipt))
    return { ok: false, reason: '回执与原定稿请求或依据不匹配，未定稿。' };
  if (!sameVersionSet(input.intent.files, input.currentFiles))
    return { ok: false, reason: '确认期间文件版本集合已变化，未定稿；请重新核对完整集合。' };
  if (input.intent.manualFinalizationId !== input.currentManualFinalizationId)
    return { ok: false, reason: '确认期间上游依据已变化，未定稿；请重新核对手册依据。' };
  return { ok: true };
}

export type OpinionScopeKind = 'PROJECT' | 'STAGE' | 'FILE_VERSION';

export interface OpinionScope {
  kind: OpinionScopeKind;
  id: string;
  label: string;
  stage: MvpStageId;
  fileId?: string | undefined;
  versionId?: string | undefined;
}

export function projectScope(projectId: string, stage: MvpStageId = 'MANUAL'): OpinionScope {
  return {
    kind: 'PROJECT',
    id: `project:${projectId}:${stage}`,
    label: `项目 ${projectId}`,
    stage,
  };
}

export function stageScope(stage: MvpStageId): OpinionScope {
  return {
    kind: 'STAGE',
    id: `stage:${stage}`,
    label: `阶段 ${mvpStageLabels[stage]}`,
    stage,
  };
}

export function fileVersionScope(
  stage: MvpStageId,
  file: { fileId: string; title: string; versionId: string; versionLabel: string },
): OpinionScope {
  return {
    kind: 'FILE_VERSION',
    id: `file:${file.fileId}:${file.versionId}`,
    label: `文件 ${file.title} · ${file.versionLabel}`,
    stage,
    fileId: file.fileId,
    versionId: file.versionId,
  };
}

export function sameScope(left: OpinionScope, right: OpinionScope): boolean {
  return left.id === right.id;
}

export interface OpinionBasis {
  planId: string;
  planVersion: number;
  manualFinalizationId?: string | undefined;
  procedureFinalizationId?: string | undefined;
  files: readonly FileVersionRef[];
}

export function sameBasis(left: OpinionBasis, right: OpinionBasis): boolean {
  return (
    left.planId === right.planId &&
    left.planVersion === right.planVersion &&
    left.manualFinalizationId === right.manualFinalizationId &&
    left.procedureFinalizationId === right.procedureFinalizationId &&
    sameVersionSet(left.files, right.files)
  );
}

export interface RevisionIntent {
  requestId: string;
  projectId: string;
  stage: MvpStageId;
  scope: OpinionScope;
  text: string;
  basis: OpinionBasis;
}

export interface RevisionReceipt {
  classification: 'DEVELOPMENT_FIXTURE_ONLY';
  requestId: string;
  projectId: string;
  stage: MvpStageId;
  scope: OpinionScope;
  basis: OpinionBasis;
}

export function revisionReceiptMatches(intent: RevisionIntent, receipt: RevisionReceipt): boolean {
  return (
    intent.requestId === receipt.requestId &&
    intent.projectId === receipt.projectId &&
    intent.stage === receipt.stage &&
    intent.scope.id === receipt.scope.id &&
    sameBasis(intent.basis, receipt.basis)
  );
}

export type SubmissionStatus = 'PENDING' | 'UNKNOWN' | 'RECEIVED' | 'FAILED';

export interface MvpSubmission {
  submissionId: string;
  requestId: string;
  scope: OpinionScope;
  text: string;
  basis: OpinionBasis;
  status: SubmissionStatus;
  note: string;
  submittedAt: string;
}

/** One project has at most one active modification batch. */
export function activeSubmission(submissions: readonly MvpSubmission[]): MvpSubmission | undefined {
  return [...submissions]
    .reverse()
    .find((submission) => submission.status === 'PENDING' || submission.status === 'UNKNOWN');
}

export type MvpDraftState = 'EMPTY' | 'UNSAVED' | 'SAVING' | 'SAVED' | 'FAILED' | 'UNKNOWN';

export const mvpDraftStateLabels: Record<MvpDraftState, string> = {
  EMPTY: '尚未输入意见',
  UNSAVED: '未保存（仅本页内存）',
  SAVING: '正在模拟保存…',
  SAVED: '模拟草稿已保存（仅本页内存）',
  FAILED: '模拟保存失败，输入仍在本页',
  UNKNOWN: '模拟保存结果待核验',
};

export interface MvpDraft {
  text: string;
  state: MvpDraftState;
  note: string;
  /** Basis captured when this draft was created or edited. */
  basis?: OpinionBasis | undefined;
  /** Original simulated save request, retained across UNKNOWN recovery. */
  requestLabel?: string | undefined;
  /** Text frozen into the original save request. */
  savedText?: string | undefined;
}

export const emptyDraft: MvpDraft = {
  text: '',
  state: 'EMPTY',
  note: '仅保存在本页内存；刷新会重置。',
};

export function draftAfterEdit(text: string, basis?: OpinionBasis): MvpDraft {
  return text
    ? {
        text,
        state: 'UNSAVED',
        note: '仅保存在本页内存；刷新会重置，不代表服务器已保存。',
        ...(basis ? { basis } : {}),
      }
    : emptyDraft;
}

export function draftWhileSaving(draft: MvpDraft, requestLabel: string): MvpDraft {
  return {
    ...draft,
    state: 'SAVING',
    note: '正在模拟保存到本页内存；没有调用服务器。',
    requestLabel,
    savedText: draft.text,
  };
}

/**
 * Editing keeps an unresolved save request and the draft's original basis.
 * A newer text is a local addition until the original request is resolved.
 */
/** A save request is unresolved while it is still saving or awaiting reconciliation. */
export function draftSaveUnresolved(draft: MvpDraft): boolean {
  return draft.state === 'SAVING' || draft.state === 'UNKNOWN';
}

export function draftAfterEditInPlace(
  draft: MvpDraft,
  text: string,
  fallbackBasis: OpinionBasis,
): MvpDraft {
  const unresolved = draft.state === 'SAVING' || draft.state === 'UNKNOWN';
  const next = draftAfterEdit(text, draft.basis ?? fallbackBasis);
  if (!unresolved) return { ...next, ...(draft.savedText ? { savedText: draft.savedText } : {}) };
  return {
    ...next,
    state: draft.state,
    ...(draft.requestLabel !== undefined ? { requestLabel: draft.requestLabel } : {}),
    ...(draft.basis ? { basis: draft.basis } : {}),
    ...(draft.savedText ? { savedText: draft.savedText } : {}),
    note: '原保存请求仍未决；新输入仅在本页，请先查询原请求。',
  };
}

/** A draft keeps its original basis until the user explicitly rebinds it. */
export function draftBasisChanged(draft: MvpDraft, basis: OpinionBasis): boolean {
  return (
    draft.text.trim().length > 0 && draft.basis !== undefined && !sameBasis(draft.basis, basis)
  );
}

export function draftAfterSaveReceipt(
  draft: MvpDraft,
  outcome: 'SAVED' | 'FAILED' | 'UNKNOWN',
): MvpDraft {
  if (outcome === 'SAVED') {
    if (draft.savedText !== undefined && draft.text !== draft.savedText)
      return {
        ...draft,
        state: 'UNSAVED',
        note: '原保存请求已返回；新输入尚未保存，可再次保存。',
      };
    return {
      ...draft,
      state: 'SAVED',
      note: '模拟草稿已保存到本页内存；刷新或关闭页面会重置。',
    };
  }
  if (outcome === 'FAILED')
    return {
      ...draft,
      state: 'FAILED',
      note: '模拟保存失败；输入仍留在本页，可重试保存。',
    };
  return {
    ...draft,
    state: 'UNKNOWN',
    note: '模拟保存结果未知；只能查询原保存动作，不能按时间推断成功。',
  };
}

export interface StageFileAvailability extends FileVersionRef {
  versions: readonly string[];
  viewedVersionId?: string | undefined;
}

export function latestVersion(file: StageFileAvailability): string | undefined {
  return file.versions.at(-1);
}

export function candidateVersion(file: StageFileAvailability): string | undefined {
  const latest = latestVersion(file);
  return latest && file.viewedVersionId && latest !== file.viewedVersionId ? latest : undefined;
}

/** Returns every stage file's viewed version, or undefined when one is missing. */
export function viewedVersionSet(
  files: readonly StageFileAvailability[],
): FileVersionRef[] | undefined {
  const set: FileVersionRef[] = [];
  for (const file of files) {
    if (!file.viewedVersionId) return undefined;
    set.push({ fileId: file.fileId, versionId: file.viewedVersionId });
  }
  return set;
}

export function stageSetBlockers(files: readonly StageFileAvailability[]): string[] {
  const blockers: string[] = [];
  const missing = files.filter((file) => !file.viewedVersionId).map((file) => file.fileId);
  if (files.length === 0) blockers.push('当前计划没有该阶段的文件。');
  if (missing.length > 0) blockers.push(`缺少文件或版本：${missing.join('、')}。`);
  if (duplicateFileIds(files).length > 0)
    blockers.push(`版本集合包含重复文件：${duplicateFileIds(files).join('、')}。`);
  return blockers;
}

export function finalizationBlocker(input: {
  supported: boolean;
  plan: { ready: boolean; reason?: string | undefined };
  upstream: UpstreamCheck;
  files: readonly StageFileAvailability[];
  active: boolean;
  finalized: boolean;
}): string | undefined {
  if (!input.supported) return '记录表单不设单独定稿关卡；请进入最终交付确认（U3）。';
  if (!input.plan.ready) return input.plan.reason ?? '计划尚未就绪。';
  if (!input.upstream.ok) return input.upstream.reason ?? '上游依据尚未就绪。';
  if (input.finalized) return '本阶段已有模拟定稿；U2 不提供上游重新定稿。';
  if (input.active) return '仍有待回执或待核验的修改请求；不能跨过它完成阶段定稿。';
  if (input.files.length === 0) return '当前计划没有该阶段的文件。';
  if (input.files.every((file) => file.versions.length === 0))
    return '尚未生成本阶段候选；请先生成并核对候选。';
  const setBlockers = stageSetBlockers(input.files);
  if (setBlockers.length > 0) return setBlockers.join(' ');
  const stale = input.files.filter((file) => candidateVersion(file) !== undefined);
  if (stale.length > 0)
    return `新候选已到达（${stale
      .map((file) => file.fileId)
      .join('、')}）；请显式切换并重新核对后再定稿。`;
  return undefined;
}
