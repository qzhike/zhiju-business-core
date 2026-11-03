import type { RunnerReadingFile, RunnerReadingPackage } from './runner-package.js';

export const runnerSteps = ['QUALITY_MANUAL', 'CONTROL_PROCEDURES', 'MANAGEMENT_RECORDS'] as const;
export const runnerLabels: Record<string, string> = {
  QUALITY_MANUAL: '质量手册',
  CONTROL_PROCEDURES: '控制程序',
  MANAGEMENT_RECORDS: '管理制度及记录表单',
  REVISING: '修订中',
  WAITING_INPUT: '等待补充或答复',
  WAITING_REVIEW: '待审阅',
  COMPLETED: '本轮处理结束',
  TERMINATED: '本轮已终止',
  DRAFT: '候选稿',
  UNCHANGED: '正文未变',
  BLOCKED: '受阻',
  FAILED: '失败',
  NOT_EXECUTED: '未执行',
  COMPLETE: '完整',
  PARTIAL: '部分完整',
  NOT_ASSESSED: '未评估',
  OPEN: '待处理',
  RESOLVED: '已解决',
  WITHDRAWN: '已撤回',
  EDIT: '暂停修改',
  NONE: '非阻断',
};
export const runnerLabel = (value: string) => runnerLabels[value] ?? value;
export const roundRouteId = (value: RunnerReadingPackage) => `R-${value.manifestSha256}`;
export const fileRouteId = (file: RunnerReadingFile) =>
  `F-${Array.from(new TextEncoder().encode(file.id), (value) => value.toString(16).padStart(2, '0')).join('')}`;
export const readingVersion = (file: RunnerReadingFile): RunnerReadingFile['candidate'] =>
  file.candidate ?? file.before ?? file.initial;
export interface RunnerDraft {
  kind: 'ISSUE' | 'FILE';
  targetId: string;
  fileSha256?: string;
  fileRole?: 'initial' | 'before' | 'candidate';
  label: string;
  text: string;
  confirmed?: boolean;
}
export type RunnerDraftAction = 'write' | 'confirm' | 'modify' | 'clear';
export interface RunnerFlowProject {
  id: string;
  taskId: string;
  title: string;
  rounds: RunnerReadingPackage[];
  viewedHash: string;
  drafts: Record<string, RunnerDraft>;
}
export interface RunnerFlowState {
  projects: RunnerFlowProject[];
}
export const runnerBase = (id: string) => `/projects/${id}`;
export function runnerFilePath(
  project: RunnerFlowProject,
  round: RunnerReadingPackage,
  file: RunnerReadingFile,
  role?: RunnerDraft['fileRole'],
) {
  return `${runnerBase(project.id)}/results/${roundRouteId(round)}/${fileRouteId(file)}${role ? `?source=${role}` : ''}`;
}
export function runnerRoundOrder(left: RunnerReadingPackage, right: RunnerReadingPackage) {
  return (
    runnerSteps.indexOf(left.identity.step as (typeof runnerSteps)[number]) -
      runnerSteps.indexOf(right.identity.step as (typeof runnerSteps)[number]) ||
    left.identity.roundNumber - right.identity.roundNumber
  );
}
export function latestRunnerRound(project: RunnerFlowProject) {
  const latest = project.rounds.toSorted(runnerRoundOrder).at(-1);
  if (!latest) throw new Error('本地项目尚无结果。');
  return latest;
}
export function viewedRunnerRound(project: RunnerFlowProject) {
  const viewed = project.rounds.find((round) => round.manifestSha256 === project.viewedHash);
  if (!viewed) throw new Error('本次阅读轮次不可用。');
  return viewed;
}
export function addRunnerRound(
  state: RunnerFlowState,
  value: RunnerReadingPackage,
  title = '体系文件修订与审阅',
) {
  const project = state.projects.find((item) => item.taskId === value.identity.taskId);
  if (!project) {
    const created: RunnerFlowProject = {
      id: `RUNNER-${value.manifestSha256.slice(0, 24)}`,
      taskId: value.identity.taskId,
      title: title.trim() || '体系文件修订与审阅',
      rounds: [value],
      viewedHash: value.manifestSha256,
      drafts: {},
    };
    if (state.projects.some((item) => item.id === created.id))
      throw new Error('本地项目标识冲突，未覆盖已有项目。');
    return { state: { projects: [...state.projects, created] }, projectId: created.id };
  }
  if (project.rounds.some((round) => round.manifestSha256 === value.manifestSha256))
    return { state, projectId: project.id };
  for (const round of project.rounds) {
    const left = round.identity;
    const right = value.identity;
    if (
      (left.step === right.step && left.stageId !== right.stageId) ||
      (left.stageId === right.stageId && left.step !== right.step)
    )
      throw new Error('业务阶段身份冲突，已有结果保持不变。');
    if (
      left.roundId === right.roundId ||
      (left.stageId === right.stageId && left.roundNumber === right.roundNumber)
    )
      throw new Error('同一轮次对应了不同交接包，已有历史保持不变。');
  }
  return {
    state: {
      projects: state.projects.map((item) =>
        item.id === project.id
          ? { ...item, rounds: [...item.rounds, value].sort(runnerRoundOrder) }
          : item,
      ),
    },
    projectId: project.id,
  };
}
export function runnerDraftKey(
  round: RunnerReadingPackage,
  draft: Pick<RunnerDraft, 'kind' | 'targetId' | 'fileSha256' | 'fileRole'>,
) {
  return JSON.stringify([
    round.manifestSha256,
    draft.kind,
    draft.targetId,
    draft.fileRole ?? null,
    draft.fileSha256 ?? null,
  ]);
}
export function runnerRoundDrafts(project: RunnerFlowProject, round: RunnerReadingPackage) {
  return Object.entries(project.drafts)
    .filter(([key, value]) => runnerDraftKey(round, value) === key && value.text.trim())
    .map(([, value]) => value);
}
export function updateRunnerDraft(
  state: RunnerFlowState,
  projectId: string,
  hash: string,
  draft: RunnerDraft,
  action: RunnerDraftAction = 'write',
): RunnerFlowState {
  return {
    projects: state.projects.map((project) => {
      if (project.id !== projectId) return project;
      const round = latestRunnerRound(project);
      if (round.manifestSha256 !== hash) return project;
      if (draft.kind === 'FILE') {
        const file = round.files.find((item) => item.id === draft.targetId);
        if (
          !file ||
          !draft.fileRole ||
          !file[draft.fileRole] ||
          file[draft.fileRole]?.ref.sha256 !== draft.fileSha256
        )
          return project;
      } else if (
        !round.issues.some((item) => item.id === draft.targetId && item.status === 'OPEN') ||
        draft.fileSha256 !== undefined ||
        draft.fileRole !== undefined
      )
        return project;
      const key = runnerDraftKey(round, draft);
      const saved = project.drafts[key];
      if (action === 'clear') {
        if (!saved) return project;
        const drafts = Object.fromEntries(
          Object.entries(project.drafts).filter(([id]) => id !== key),
        );
        return { ...project, drafts };
      }
      if (action === 'confirm') {
        if (!saved?.text.trim() || saved.confirmed) return project;
        return { ...project, drafts: { ...project.drafts, [key]: { ...saved, confirmed: true } } };
      }
      if (action === 'modify') {
        if (!saved?.confirmed) return project;
        return { ...project, drafts: { ...project.drafts, [key]: { ...saved, confirmed: false } } };
      }
      if (saved?.confirmed) return project;
      return { ...project, drafts: { ...project.drafts, [key]: { ...draft, confirmed: false } } };
    }),
  };
}
