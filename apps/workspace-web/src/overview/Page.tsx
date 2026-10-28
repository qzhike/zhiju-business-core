import { Link } from 'react-router';
import { JourneyNav, type JourneyReviewStage } from '../mvp/JourneyNav.js';
import './overview.css';

export interface OverviewStage {
  id: string;
  label: string;
  state: string;
  detail: string;
}
export interface OverviewLevel {
  id: string;
  label: string;
  inputCount: number;
  plannedCount: number;
  detail: string;
}
interface Props {
  project: { id: string; customerLabel: string; title: string; code: string };
  stages: readonly OverviewStage[];
  levels: readonly OverviewLevel[];
  reportId: string;
  planVersion: number | null;
  scopeEnabled: boolean;
  reviewStages?: readonly JourneyReviewStage[] | undefined;
  next: { label: string; href: string; reason: string };
}
type StepState = 'COMPLETE' | 'CURRENT' | 'ATTENTION' | 'UPCOMING';

function stageStepState(state: string): StepState {
  if (state.includes('依据已变化') || state.includes('待复核')) return 'ATTENTION';
  if (state.includes('已定稿') || state.includes('已复核')) return 'COMPLETE';
  if (state.includes('未开始') || state.startsWith('等待')) return 'UPCOMING';
  return 'CURRENT';
}

export function ProjectOverviewPage({
  project,
  stages,
  levels,
  reportId,
  planVersion,
  scopeEnabled,
  reviewStages,
  next,
}: Props) {
  const currentStageIndex = (() => {
    const active = stages.findIndex((stage) => {
      const state = stageStepState(stage.state);
      return state === 'CURRENT' || state === 'ATTENTION';
    });
    if (active >= 0) return active;
    return stages.length > 0 && stages.every((stage) => stageStepState(stage.state) === 'COMPLETE')
      ? stages.length - 1
      : -1;
  })();
  const currentStage = currentStageIndex >= 0 ? stages[currentStageIndex] : undefined;
  return (
    <div className="overview-page">
      <JourneyNav
        current="overview"
        analysisReportId={reportId}
        scopeEnabled={scopeEnabled}
        reviewStages={reviewStages}
      />
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {project.customerLabel} · {project.code} · {project.id}
          </p>
          <h1 tabIndex={-1}>{project.title}</h1>
          <p className="muted">项目概览 · U1 页面演练 · 不表示真实业务阶段已开始</p>
        </div>
      </div>
      <div className="demo" role="note">
        开发演练项目 · 资料、分析、计划和回执均为合成内容；不调用 Core 或 Runner，刷新清理本页内存。
      </div>
      <section className="panel overview-next" aria-label="当前下一步">
        <h2>当前下一步</h2>
        <p>{next.reason}</p>
        <Link className="button primary" to={next.href}>
          {next.label}
        </Link>
      </section>
      <div className="overview-grid">
        <section className="panel" aria-label="三个业务阶段">
          <h2>三个业务阶段</h2>
          <p className="muted">页面访问、等待时间或候选数量都不代表阶段完成。</p>
          <ol className="overview-steps" aria-label="三个业务阶段当前进度">
            {stages.map((stage, index) => {
              const state = stageStepState(stage.state);
              return (
                <li
                  key={stage.id}
                  data-state={state}
                  aria-current={index === currentStageIndex ? 'step' : undefined}
                >
                  <span className="overview-step-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="overview-step-body">
                    <strong>{stage.label}</strong>
                    <span className="status-tag">{stage.state}</span>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="overview-progress" role="status">
            {currentStage
              ? `当前进度：第 ${currentStageIndex + 1} 步 · ${currentStage.label} · ${currentStage.state}`
              : '当前进度：尚未开始'}
          </p>
          <details className="overview-stage-details">
            <summary>查看阶段依据与历史</summary>
            <ul>
              {stages.map((stage) => (
                <li key={stage.id}>
                  <strong>{stage.label}</strong> · {stage.state}
                  <p>{stage.detail}</p>
                </li>
              ))}
            </ul>
          </details>
        </section>
        <section className="panel" aria-label="四个文件层级">
          <h2>四个文件层级</h2>
          <p className="muted">层级是文件组织方式，不是串行审批关卡，也不是阶段顺序。</p>
          <ul className="overview-levels">
            {levels.map((level) => (
              <li key={level.id}>
                <strong>{level.label}</strong>
                <span>
                  输入 {level.inputCount} · 本轮计划 {level.plannedCount}
                </span>
                <details>
                  <summary>查看说明</summary>
                  <p>{level.detail}</p>
                </details>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="muted">
        当前分析报告 {reportId}
        {planVersion === null ? ' · 尚未形成范围计划' : ` · 范围计划第 ${planVersion} 版`}
      </p>
    </div>
  );
}
