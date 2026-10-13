import type { PageChain } from '../trusted/hooks.js';
import type { BoardRow, DirectoryCard } from '../trusted/protocol.js';
import type { ProjectView, ReadNotice, WorkCard, WorkGroup } from './model.js';

const statuses: Record<string, { group: WorkGroup; label: string; reason: string }> = {
  DRAFT: { group: 'waiting', label: '草拟中', reason: '范围仍在准备，尚未开始。' },
  BACKLOG: { group: 'waiting', label: '待安排', reason: '等待安排工作。' },
  PLANNED: { group: 'waiting', label: '已规划', reason: '已纳入计划，尚未开始处理。' },
  NOT_STARTED: { group: 'waiting', label: '未开始', reason: '尚未开始处理。' },
  NOT_READY: { group: 'waiting', label: '尚未就绪', reason: '工作条件尚未满足，不能开始处理。' },
  READY: { group: 'waiting', label: '待开始', reason: '已就绪，等待执行；就绪不代表已运行。' },
  IN_PROGRESS: {
    group: 'running',
    label: '处理中',
    reason: '正在推进，尚无文件候选数量可供读取。',
  },
  WAITING_INPUT: { group: 'attention', label: '等待输入', reason: '需要补充输入后才能继续。' },
  BLOCKED: { group: 'attention', label: '存在阻断', reason: '存在尚未解决的阻断条件。' },
  IN_REVIEW: {
    group: 'attention',
    label: '等待检查',
    reason: '当前工作等待检查；本摘要不包含可打开的候选引用。',
  },
  CHANGES_REQUIRED: { group: 'attention', label: '需要修改', reason: '检查要求修改，尚未完成。' },
  COMPLETION_PENDING: {
    group: 'running',
    label: '等待完成判定',
    reason: '正在等待业务完成判定，不能视为已完成。',
  },
  APPROVED_OUTPUT: {
    group: 'running',
    label: '成果已批准',
    reason: '成果已批准，交付项仍未完成。',
  },
  RELEASED: {
    group: 'running',
    label: '成果已发布',
    reason: '成果已发布，仍以交付项完成判定为准。',
  },
  COMPLETED: { group: 'done', label: '已完成', reason: '仅此工作已完成，不表示项目已发布或交付。' },
  CANCELLED: { group: 'done', label: '已取消', reason: '此工作已取消，不计为成功完成。' },
};

export function directoryProject(card: DirectoryCard): ProjectView {
  return {
    key: card.key,
    enterpriseId: card.enterpriseId,
    projectId: card.projectId,
    name: `${card.enterpriseDisplayName} · ${card.title}`,
    title: card.title,
    code: card.displayCode,
    status: card.status === 'ACTIVE' ? '进行中' : `项目状态 ${card.status}`,
    version: card.aggregateVersion,
    progress: '选择项目后读取交付项与任务进度',
  };
}

export function boardCards(
  project: DirectoryCard,
  chain: PageChain<BoardRow>,
  kind: 'task' | 'delivery-item',
): WorkCard[] {
  // Failed reads, especially revoked access, never leave old rows as an offline copy.
  if (chain.state.dataState !== 'READY') return [];
  return chain.state.items.map((row) => {
    const state = statuses[row.status] ?? {
      group: 'attention',
      label: '状态待核实',
      reason: '来源状态尚无展示映射，请核实原工作。',
    };
    const destination =
      kind === 'task'
        ? ({
            kind,
            projectId: project.projectId,
            taskId: row.key,
            version: row.version ?? 0,
          } as const)
        : ({ kind, projectId: project.projectId, itemId: row.key } as const);
    return {
      id: `${kind}-${row.key}`,
      projectKey: project.key,
      title: row.title,
      group: state.group,
      status: state.label,
      reason: `${state.reason}${row.blockers > 0 ? ` 已记录 ${row.blockers} 项阻断。` : ''}`,
      context: `${kind === 'task' ? '任务' : '交付项'} · ${row.status}${row.secondary === null ? '' : ` · ${row.secondary}`}${row.version === null ? '' : ` · 版本 ${row.version}`} · ${row.key}`,
      action: {
        label: kind === 'task' ? '查看任务入口（暂不可用）' : '查看交付入口（暂不可用）',
        destination,
      },
    };
  });
}

const errors: Record<string, string> = {
  DEPENDENCY_UNAVAILABLE: '依赖服务暂不可用，未显示任何数据。',
  UI_SERVICE_NOT_CONFIGURED: '尚未接入该公开服务，请联系管理员。',
  ACCESS_DENIED: '当前身份无权读取，请联系管理员确认授权。',
  AUTHORIZATION_REVOKED: '授权已撤销，已清除该来源的内容。',
  NOT_FOUND: '该对象对当前身份不可见，请返回授权项目目录。',
};
const freshness: Record<string, string> = {
  FRESH: '当前观察',
  STALE: '滞后',
  PAUSED: '暂停',
  REBUILDING: '重建中',
  FAILED: '失败',
};

export function chainNotice<T>(
  id: string,
  title: string,
  chain: PageChain<T>,
  directory = false,
): ReadNotice {
  const { state } = chain;
  const base: ReadNotice = { id, title, state: state.dataState, detail: '' };
  if (state.dataState === 'LOADING')
    return {
      ...base,
      title: directory ? '正在读取授权项目目录' : title,
      detail: state.enumerating ? '本页没有匹配项，仍在继续读取；当前不是空结果。' : '正在读取…',
    };
  if (state.dataState === 'ERROR')
    return {
      ...base,
      title: directory
        ? '无法读取项目目录'
        : id === 'tasks'
          ? '该项目任务看板当前不可用'
          : '该项目交付项看板当前不可用',
      detail: `${errors[chain.failureCode ?? ''] ?? '无法安全读取数据，请重新读取。'} ${chain.failureCode ?? ''}`,
      action: { label: directory ? '重新读取目录' : `重新读取${title}`, run: chain.reload },
    };
  const observation = state.observation;
  return {
    ...base,
    title: state.dataState === 'EMPTY' && directory ? '没有可访问的项目' : title,
    detail: directory
      ? `已显示 ${state.items.length} 个项目 · ${state.terminal ? '本次枚举完整' : '目录尚未枚举完'}`
      : `本次读取 ${state.items.length} 条 · ${state.terminal ? '本次枚举完整' : '仅部分结果'}${state.dataState === 'EMPTY' ? '，不代表业务已完成' : ''}`,
    ...(observation === null
      ? {}
      : {
          observation: `观察点 ${observation.snapshotAt ?? '未知'} · ${freshness[observation.freshness] ?? observation.freshness} · 水位 ${observation.sourceWatermarks.map((mark) => `${mark.sourceModule}#${mark.sequence}`).join('、') || '无源水位'}`,
        }),
    ...(!state.terminal || (observation !== null && observation.freshness !== 'FRESH')
      ? { warning: '数据尚未完整或不是最新；不能据此推导全部工作的状态。' }
      : {}),
    ...(state.enumerating && !state.inFlight
      ? { action: { label: '继续读取', run: chain.loadMore } }
      : {}),
  };
}
