import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { RunnerReadingPackage } from './runner-package.js';
import {
  addRunnerRound,
  updateRunnerDraft,
  type RunnerDraft,
  type RunnerDraftAction,
  type RunnerFlowState,
} from './runner-flow-model.js';

interface RunnerFlowApi extends RunnerFlowState {
  add: (round: RunnerReadingPackage, title?: string) => string;
  view: (projectId: string, hash: string) => void;
  draft: (projectId: string, hash: string, draft: RunnerDraft) => void;
  draftAction: (
    projectId: string,
    hash: string,
    draft: RunnerDraft,
    action: Exclude<RunnerDraftAction, 'write'>,
  ) => void;
  clear: (projectId: string) => void;
}
const Context = createContext<RunnerFlowApi | null>(null);
export function FixtureRunnerFlowProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RunnerFlowState>({ projects: [] });
  const current = useRef(state);
  const update = (next: RunnerFlowState) => {
    current.current = next;
    setState(next);
  };
  return (
    <Context.Provider
      value={{
        ...state,
        add: (round, title) => {
          const result = addRunnerRound(current.current, round, title);
          update(result.state);
          return result.projectId;
        },
        view: (id, hash) => {
          update({
            projects: current.current.projects.map((project) =>
              project.id === id && project.rounds.some((round) => round.manifestSha256 === hash)
                ? { ...project, viewedHash: hash }
                : project,
            ),
          });
        },
        draft: (id, hash, draft) => {
          update(updateRunnerDraft(current.current, id, hash, draft));
        },
        draftAction: (id, hash, draft, action) => {
          update(updateRunnerDraft(current.current, id, hash, draft, action));
        },
        clear: (id) => {
          update({ projects: current.current.projects.filter((project) => project.id !== id) });
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useRunnerFlow() {
  const value = useContext(Context);
  if (!value) throw new Error('DEVELOPMENT_RUNNER_FLOW_REQUIRED');
  return value;
}
export function FixtureRunnerFlowNotice() {
  const { pathname } = useLocation();
  const { projects } = useRunnerFlow();
  if (pathname === '/workbench' && projects.length > 0)
    return (
      <>
        页面验收 · 工作台包含合成样例与已导入结果；本地结果及意见仅保留当前会话，未连接执行或提交。
      </>
    );
  return pathname.startsWith('/projects/RUNNER-') || pathname === '/runner-output' ? (
    <>本地页面验收 · 展示已导入的结果，答复与意见仅保留当前会话；未连接执行、提交或定稿。</>
  ) : (
    <>开发样例模式 · 合成报告、回执及进度；不上传或读取 ZIP 内容，不调用 Core 或 Runner。</>
  );
}
