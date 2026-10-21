import { Link } from 'react-router';
import { JourneyNav } from '../mvp/JourneyNav.js';
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
  next: { label: string; href: string; reason: string };
}
export function ProjectOverviewPage({
  project,
  stages,
  levels,
  reportId,
  planVersion,
  scopeEnabled,
  next,
}: Props) {
  return (
    <div className="overview-page">
      <JourneyNav current="overview" analysisReportId={reportId} scopeEnabled={scopeEnabled} />
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
          <ol className="overview-stages">
            {stages.map((stage) => (
              <li key={stage.id}>
                <strong>{stage.label}</strong>
                <span className="status-tag">{stage.state}</span>
                <p>{stage.detail}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="panel" aria-label="四个文件层级">
          <h2>四个文件层级</h2>
          <p className="muted">层级是文件组织方式，不是串行审批关卡。</p>
          <ul className="overview-levels">
            {levels.map((level) => (
              <li key={level.id}>
                <strong>{level.label}</strong>
                <span>
                  输入 {level.inputCount} · 本轮计划 {level.plannedCount}
                </span>
                <p>{level.detail}</p>
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
