// Public-safe U3 rehearsal content. It contains no customer identity, excerpt,
// original bytes, private path or Runner output. Every value is a synthetic
// presentation fact tied to the anonymous C01–C07 / T01–T06 source IDs.
import type { MvpStageId } from '../mvp/review-model.js';
import type { ExecutionFileObservation, ReworkFileImpact } from '../mvp/u3-model.js';

export const u3RehearsalNote =
  '环境 A · 开发演练 · 所有请求、候选、回执、包成员与下载均为合成内存状态；刷新重置，不调用 Core 或 Runner。';

/** Reasons supplied for the downstream stage after a manual re-finalization. */
export const u3ManualImpactFiles: readonly ReworkFileImpact[] = [
  {
    fileId: 'F-PROCEDURE',
    title: '变更控制程序',
    stage: 'PROCEDURES',
    action: 'REVISE',
    reason:
      '手册返工新增变更控制章节与下游依据说明；程序需同步分流判定、判定人/日期和手册版本引用。',
  },
  {
    fileId: 'F-EXTERNAL-RULE',
    title: '外来文件管理规定',
    stage: 'PROCEDURES',
    action: 'RETAIN',
    reason: '外来文件识别、评审与分发职责未受手册返工影响；保留已确认版本，不重新生成。',
  },
  {
    fileId: 'F-FORM-APPLY',
    title: '变更申请单',
    stage: 'RECORDS',
    action: 'REVISE',
    reason: '申请单需引用返工后的手册版本，并保留分流判定栏与客户现有签批位置。',
  },
  {
    fileId: 'F-FORM-REVIEW',
    title: '变更评审记录',
    stage: 'RECORDS',
    action: 'REVISE',
    reason: '评审记录需同步新的手册依据与风险触发说明；不新增审批层级。',
  },
  {
    fileId: 'F-FORM-IMPLEMENT',
    title: '变更实施记录',
    stage: 'RECORDS',
    action: 'REVISE',
    reason: '实施记录的关联编号与手册/程序引用需随返工依据更新。',
  },
  {
    fileId: 'F-FORM-NOTICE',
    title: '变更通知单',
    stage: 'RECORDS',
    action: 'RETAIN',
    reason: '通知字段与本次手册返工无直接依赖；保留现有版本并说明保留理由。',
  },
];

/** Reasons supplied after the second-stage set is re-finalized. */
export const u3ProcedureImpactFiles: readonly ReworkFileImpact[] = [
  {
    fileId: 'F-FORM-APPLY',
    title: '变更申请单',
    stage: 'RECORDS',
    action: 'REVISE',
    reason: '程序返工更新了分流判定依据；申请单需同步引用并在复核时核对判定栏。',
  },
  {
    fileId: 'F-FORM-REVIEW',
    title: '变更评审记录',
    stage: 'RECORDS',
    action: 'REVISE',
    reason: '程序返工更新了风险触发与手册依据；评审记录需同步字段说明。',
  },
  {
    fileId: 'F-FORM-IMPLEMENT',
    title: '变更实施记录',
    stage: 'RECORDS',
    action: 'REVISE',
    reason: '实施记录需同步新的程序版本引用与关联编号。',
  },
  {
    fileId: 'F-FORM-NOTICE',
    title: '变更通知单',
    stage: 'RECORDS',
    action: 'RETAIN',
    reason: '通知字段与本次程序返工无直接依赖；保留现有版本并说明保留理由。',
  },
];

export const u3ImpactNote =
  '影响标记按阶段保守覆盖整个下游阶段，再按文件给出修改/保留理由；它不自动抹掉下游成果或历史确认。';

interface SessionFileLike {
  versions: string[];
  viewedVersionId?: string | undefined;
  recheckedVersionId?: string | undefined;
}

/** Adds a simulated candidate version without changing the current view or finalization. */
export function addSessionVersion<T extends { files: Record<string, SessionFileLike> }>(
  session: T,
  fileId: string,
  versionId: string,
): T {
  const current = session.files[fileId] ?? { versions: [] };
  if (current.versions.includes(versionId)) return session;
  return {
    ...session,
    files: {
      ...session.files,
      [fileId]: {
        ...current,
        versions: [...current.versions, versionId].sort(),
      },
    },
  };
}

/** Explicitly adopts each file's latest candidate as the viewed/rechecked version. */
export function adoptLatestVersions<T extends { files: Record<string, SessionFileLike> }>(
  session: T,
  fileIds: readonly string[],
): T {
  const files = { ...session.files };
  let changed = false;
  for (const fileId of fileIds) {
    const current = files[fileId];
    const latest = current?.versions.at(-1);
    if (!current || !latest) continue;
    if (current.viewedVersionId === latest && current.recheckedVersionId === latest) continue;
    files[fileId] = { ...current, viewedVersionId: latest, recheckedVersionId: latest };
    changed = true;
  }
  return changed ? { ...session, files } : session;
}

export interface ExecutionSeedFile {
  fileId: string;
  title: string;
  stage: MvpStageId;
  state: ExecutionFileObservation['state'];
  versionId?: string | undefined;
  error?: string | undefined;
  provenance: string;
  linkedCorrection?: { versionId: string; reason: string } | undefined;
}

export const u3ExecutionSeedFiles: readonly ExecutionSeedFile[] = [
  {
    fileId: 'F-MANUAL',
    title: '质量手册',
    stage: 'MANUAL',
    state: 'SUCCEEDED',
    versionId: 'V2',
    provenance: '既有已定稿依据 · F-MANUAL@V2',
  },
  {
    fileId: 'F-PROCEDURE',
    title: '变更控制程序',
    stage: 'PROCEDURES',
    state: 'SUCCEEDED',
    versionId: 'V2',
    provenance: '既有已定稿依据 · F-PROCEDURE@V2',
  },
  {
    fileId: 'F-EXTERNAL-RULE',
    title: '外来文件管理规定',
    stage: 'PROCEDURES',
    state: 'SUCCEEDED',
    versionId: 'V2',
    provenance: '既有已定稿依据 · F-EXTERNAL-RULE@V2',
  },
  {
    fileId: 'F-FORM-APPLY',
    title: '变更申请单',
    stage: 'RECORDS',
    state: 'FAILED',
    error: '合成场景：读取上游依据超时；未生成候选，原成功文件不受影响。',
    provenance: '本轮修改批次 · 失败尝试 A1',
  },
  {
    fileId: 'F-FORM-REVIEW',
    title: '变更评审记录',
    stage: 'RECORDS',
    state: 'FAILED',
    error: '合成场景：关联编号映射冲突；需要人工核对后仅重试本文件。',
    provenance: '本轮修改批次 · 失败尝试 A1',
  },
  {
    fileId: 'F-FORM-IMPLEMENT',
    title: '变更实施记录',
    stage: 'RECORDS',
    state: 'REVIEWABLE',
    versionId: 'V2',
    provenance: '本轮修改批次 · 可审阅结果 A1',
    linkedCorrection: {
      versionId: 'V3',
      reason: '关联编号引用随手册返工更新；形成可追溯新版本，不覆盖 V2。',
    },
  },
  {
    fileId: 'F-FORM-NOTICE',
    title: '变更通知单',
    stage: 'RECORDS',
    state: 'WAITING',
    provenance: '本轮修改批次 · 等待安排',
  },
];

export const u3ExecutionFixedInputs: readonly string[] = [
  '已确认计划 U1-PLAN-01 第 1 版',
  '输入依据 C01–C07、A1',
  '正式模板快照 T01–T06',
  '质量手册定稿与第二阶段完整集合（精确版本）',
];

export const u3ExecutionErrors: readonly string[] = [
  'A1：F-FORM-APPLY 读取上游依据超时；失败前未写出候选。',
  'A1：F-FORM-REVIEW 关联编号映射冲突；保留错误历史，成功文件不重新生成。',
  'A1：F-FORM-IMPLEMENT 的关联修正已形成 V3 候选，原 V2 保留。',
];
