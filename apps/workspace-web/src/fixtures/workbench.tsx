// Isolated development adapter. It never performs business requests or saves data.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Workbench } from '../workbench/Workbench.js';
import {
  selectedProjectKey,
  workbenchPath,
  type ProjectView,
  type WorkCard,
} from '../workbench/model.js';
import { MvpHandoffContext } from './handoff.js';

const projects: readonly [ProjectView, ProjectView, ProjectView] = [
  {
    key: 'project:WB-ENTERPRISE-01/DEMO-PROJECT-01',
    enterpriseId: 'WB-ENTERPRISE-01',
    projectId: 'DEMO-PROJECT-01',
    name: '青禾制造 · 体系文件升级',
    title: '体系文件升级',
    code: 'QH-2026',
    status: '进行中 · 演示',
    version: 3,
    progress: '交付项 12 / 24 · 固定合成进度',
  },
  {
    key: 'project:WB-ENTERPRISE-02/DEMO-PROJECT-02',
    enterpriseId: 'WB-ENTERPRISE-02',
    projectId: 'DEMO-PROJECT-02',
    name: '远山科技 · 华东与华南多基地质量体系建设及年度审核资料准备项目',
    title: '华东与华南多基地质量体系建设及年度审核资料准备项目',
    code: 'YS-2026',
    status: '资料准备 · 演示',
    version: 1,
    progress: '交付项 6 / 18 · 固定合成进度',
  },
  {
    key: 'project:U1-ENTERPRISE/MVP-U1-PROJECT',
    enterpriseId: 'U1-ENTERPRISE',
    projectId: 'MVP-U1-PROJECT',
    name: '匿名客户 C01–C07 · 变更控制体系文件升级',
    title: '变更控制体系文件升级',
    code: 'U1-REHEARSAL',
    status: 'U1 页面演练 · 非业务事实',
    version: 1,
    progress: '资料 1 批 / 计划 1 版 · 固定合成状态',
  },
];
const first = projects[0];
const second = projects[1];
const u1 = projects[2];
const reportId = 'DEMO-STARTUP-REPORT-01';
const fixtureCards: readonly WorkCard[] = [
  {
    id: 'wb-analysis',
    projectKey: first.key,
    title: '体系文件升级 · 分析报告',
    group: 'attention',
    status: '报告待核对',
    reason: '需要核对客户资料缺口与本轮文件计划；2 份文件有待处理意见。',
    context: `${reportId} · 第 1 版`,
    action: {
      label: '查看分析报告',
      destination: { kind: 'analysis', projectId: first.projectId, reportId },
    },
  },
  {
    id: 'wb-files',
    projectKey: first.key,
    title: '体系文件升级 · 文件进度',
    group: 'attention',
    status: '部分候选待检查',
    reason: '已有候选可检查，其余文件继续处理。',
    context: 'WB-ROUND-01 · 原报告第 1 版',
    counts: { review: 3, working: 7 },
    action: {
      label: '查看文件进度',
      destination: { kind: 'execution', projectId: first.projectId, requestId: 'WB-ROUND-01' },
    },
    secondaryAction: {
      label: '检查文件',
      destination: {
        kind: 'file',
        projectId: first.projectId,
        fileId: 'WB-FILE-01',
        revisionId: 'WB-REVISION-03',
      },
    },
  },
  {
    id: 'wb-unknown',
    projectKey: second.key,
    title: '启动范围 · 结果待核实',
    group: 'attention',
    status: 'UNKNOWN · 结果未知',
    reason: '尚未确认原请求结果；不能再次开始或视为已失败。',
    context: 'WB-REQUEST-02 · 原请求',
    action: {
      label: '查看原请求入口',
      destination: { kind: 'execution', projectId: second.projectId, requestId: 'WB-REQUEST-02' },
    },
  },
  {
    id: 'wb-running',
    projectKey: first.key,
    title: '生产记录表格编制',
    group: 'running',
    status: '处理中',
    reason: '按已确认范围准备 8 份模板，尚未形成候选。',
    context: 'WB-ROUND-03 · 已确认范围',
    counts: { review: 0, working: 8 },
    action: {
      label: '查看本轮进度',
      destination: { kind: 'execution', projectId: first.projectId, requestId: 'WB-ROUND-03' },
    },
  },
  {
    id: 'wb-waiting',
    projectKey: second.key,
    title: '内审资料整理',
    group: 'waiting',
    status: '待确认范围',
    reason: '先确认本次工作范围与使用的资料；尚未执行。',
    context: 'WB-REPORT-02 · 第 1 版',
    action: {
      label: '核对范围入口',
      destination: { kind: 'startup', projectId: second.projectId, reportId: 'WB-REPORT-02' },
    },
  },
  {
    id: 'wb-intake',
    projectKey: first.key,
    title: '首轮客户资料',
    group: 'waiting',
    status: '等待资料',
    reason: '准备一份客户资料 ZIP，再核对分析报告。',
    context: 'QH-2026 · 当前项目',
    action: { label: '准备客户资料', destination: { kind: 'intake', projectId: first.projectId } },
  },
  {
    id: 'wb-done',
    projectKey: first.key,
    title: '采购成果检查',
    group: 'done',
    status: '检查已完成 · 未交付',
    reason: '3 份文件已检查；正式交付仍需核验本批范围和精确版本。',
    context: 'WB-FILE-04 · WB-REVISION-02',
    action: {
      label: '查看检查版本',
      destination: {
        kind: 'file',
        projectId: first.projectId,
        fileId: 'WB-FILE-04',
        revisionId: 'WB-REVISION-02',
      },
    },
  },
];

interface FixtureBoardState {
  cards: readonly WorkCard[];
  mode: string;
  setMode: (mode: string) => void;
  pending: boolean;
  schedule: (kind: 'candidate' | 'report') => void;
}
const BoardContext = createContext<FixtureBoardState | null>(null);

export function FixtureWorkbenchProvider({ children }: { children: ReactNode }) {
  const [cards, setCards] = useState(fixtureCards);
  const [mode, setMode] = useState('mixed');
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  const schedule = (kind: 'candidate' | 'report') => {
    if (timer.current !== undefined) return;
    setPending(true);
    timer.current = setTimeout(() => {
      setCards((current) =>
        current.map((card) => {
          if (
            kind === 'candidate' &&
            card.id === 'wb-files' &&
            card.counts &&
            card.counts.working > 0
          )
            return {
              ...card,
              counts: { review: card.counts.review + 1, working: card.counts.working - 1 },
              reason: '有新候选交回；当前精确检查版本保持不变。',
            };
          if (kind === 'report' && card.id === 'wb-analysis')
            return {
              ...card,
              reason: '第 2 版报告已到达。原报告及未处理计划意见保留，请主动查看新报告。',
              secondaryAction: {
                label: '查看第 2 版报告',
                destination: {
                  kind: 'analysis',
                  projectId: first.projectId,
                  reportId: 'DEMO-STARTUP-REPORT-02',
                },
              },
            };
          return card;
        }),
      );
      setPending(false);
      timer.current = undefined;
    }, 1500);
  };
  return (
    <BoardContext.Provider value={{ cards, mode, setMode, pending, schedule }}>
      {children}
    </BoardContext.Provider>
  );
}

export function FixtureWorkbench() {
  const state = useContext(BoardContext);
  if (!state) throw new Error('DEVELOPMENT_WORKBENCH_ADAPTER_MISSING');
  const handoff = useContext(MvpHandoffContext);
  const navigate = useNavigate();
  const location = useLocation();
  const selectedKey = selectedProjectKey(location.search);
  const mode = state.mode;
  const unavailable = mode === 'denied' || mode === 'expired' || mode === 'error';
  const loading = mode === 'loading';
  const projectViews: readonly ProjectView[] = projects.map((project) =>
    project.projectId === u1.projectId
      ? {
          ...project,
          status: handoff?.projectStatus ?? project.status,
          progress: handoff?.projectProgress ?? project.progress,
        }
      : project,
  );
  const mvpNext = handoff?.next;
  const mvpCard: WorkCard = {
    id: 'wb-u1',
    projectKey: u1.key,
    title: 'M1 连续演练 · 当前任务',
    group: handoff?.projectStatus === '正在打包' ? 'running' : 'attention',
    status: handoff?.projectStatus ?? '待处理 · 演练',
    reason: mvpNext?.reason ?? '进入当前工作继续同一项目；页面状态保留在当前会话内存。',
    context: handoff?.projectProgress ?? '资料 1 批 · 分析准备中',
    action: {
      label: '进入当前工作',
      destination: { kind: 'work', projectId: u1.projectId },
    },
  };
  const cards = [mvpCard, ...state.cards];
  return (
    <Workbench
      key={selectedKey ?? 'all'}
      selectedKey={selectedKey}
      onSelect={(key) => {
        void navigate(workbenchPath(projectViews.find((project) => project.key === key) ?? null));
      }}
      projects={unavailable || loading || mode === 'empty' ? [] : projectViews}
      cards={unavailable || loading || mode === 'empty' ? [] : cards}
      directory={{
        id: 'directory',
        title:
          mode === 'expired'
            ? '需要重新登录'
            : mode === 'denied'
              ? '当前无权访问'
              : mode === 'error'
                ? '无法读取项目目录'
                : mode === 'loading'
                  ? '正在读取授权项目目录'
                  : mode === 'empty'
                    ? '没有可访问的项目'
                    : '授权项目',
        state: unavailable ? 'ERROR' : loading ? 'LOADING' : mode === 'empty' ? 'EMPTY' : 'READY',
        detail: unavailable
          ? `${mode === 'expired' ? '会话过期，已清理展示内容' : mode === 'denied' ? '拒绝读取，不保留旧卡片' : '读取失败，不能解释为零工作'} · 演示`
          : loading
            ? '正在等待读取 · 演示'
            : mode === 'empty'
              ? '完整空结果 · 演示'
              : '已显示 3 个项目 · 完整合成场景',
        ...(unavailable || loading
          ? {
              action: {
                label: '恢复演示读取',
                run: () => {
                  state.setMode('mixed');
                },
              },
            }
          : {}),
      }}
      sources={
        mode === 'stale'
          ? [
              {
                id: 'stale',
                title: '部分观察 · 演示',
                state: 'READY',
                detail: '当前仅有部分结果，未读完的工作不计为零。',
                warning:
                  'STALE · 观察点 2026-10-13 09:00（Asia/Shanghai）· 水位 41 / 44，不是最新。',
              },
            ]
          : []
      }
      coverage="开发场景 · 各数量由固定合成数据提供，不代表真实服务、运行、批准或项目完成。"
      controls={
        <details className="wb-controls">
          <summary>演示控制</summary>
          <div>
            <button
              onClick={() => {
                state.setMode(mode === 'empty' ? 'mixed' : 'empty');
              }}
            >
              {mode === 'empty' ? '查看匿名示例' : '查看空工作台'}
            </button>
            <label>
              页面状态
              <select
                value={mode}
                onChange={(event) => {
                  state.setMode(event.target.value);
                }}
              >
                {[
                  ['mixed', '混合工作'],
                  ['loading', '加载中'],
                  ['empty', '完整空结果'],
                  ['error', '读取失败'],
                  ['denied', '拒绝访问'],
                  ['expired', '会话过期'],
                  ['stale', '陈旧 / 部分结果'],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={state.pending}
              onClick={() => {
                state.schedule('candidate');
              }}
            >
              延迟返回一份候选
            </button>
            <button
              disabled={state.pending}
              onClick={() => {
                state.schedule('report');
              }}
            >
              延迟返回新报告
            </button>
            <span role="status">
              {state.pending
                ? '等待合成更新；可继续输入或打开其他页面'
                : '仅更新本次内存中的演示卡片，刷新后重置'}
            </span>
          </div>
        </details>
      }
    />
  );
}
