import { useContext } from 'react';
import { Link } from 'react-router';
import { MvpHandoffContext } from '../fixtures/handoff.js';

const base = '/projects/MVP-U1-PROJECT';
const primary = [
  { id: 'overview', label: '项目概览', path: `${base}/overview` },
  { id: 'intake', label: '资料', path: `${base}/intake` },
  { id: 'results', label: '处理结果', path: `${base}/results` },
  { id: 'delivery', label: '交付', path: `${base}/delivery` },
] as const;
const oldSteps = [
  { id: 'analysis', label: '分析与澄清', path: `${base}/analysis/U1-REPORT-01` },
  { id: 'scope', label: '修改范围', path: `${base}/startup/U1-REPORT-02` },
] as const;

export interface JourneyReviewStage {
  id: 'MANUAL' | 'PROCEDURES' | 'RULES';
  label: string;
  href: string;
  ready: boolean;
  reason?: string | undefined;
}

export function JourneyNav({
  current,
  analysisReportId,
  scopeEnabled,
  reviewStages,
}: {
  current: string;
  analysisReportId: string;
  scopeEnabled: boolean;
  reviewStages?: readonly JourneyReviewStage[] | undefined;
}) {
  const handoff = useContext(MvpHandoffContext);
  const u3Stages = handoff?.u3Stages ?? [];
  const primaryCurrent =
    current === 'delivery'
      ? 'delivery'
      : current === 'intake'
        ? 'intake'
        : current === 'overview'
          ? 'overview'
          : 'results';
  return (
    <nav className="journey-nav" aria-label="项目导航">
      <p className="muted">
        同一项目 MVP-U1-PROJECT · 项目内选择处理结果、阶段与轮次；页面访问不改变阶段完成状态。
      </p>
      <ol>
        {primary.map((step) => (
          <li key={step.id}>
            <Link aria-current={primaryCurrent === step.id ? 'page' : undefined} to={step.path}>
              {step.label}
            </Link>
          </li>
        ))}
      </ol>
      <details className="journey-rehearsal">
        <summary>演练页面与阶段入口</summary>
        <ul>
          {oldSteps.map((step) => (
            <li key={step.id}>
              <Link
                aria-current={current === step.id ? 'page' : undefined}
                to={step.id === 'analysis' ? `${base}/analysis/${analysisReportId}` : step.path}
                aria-disabled={step.id === 'scope' && !scopeEnabled ? 'true' : undefined}
                onClick={(event) => {
                  if (step.id === 'scope' && !scopeEnabled) event.preventDefault();
                }}
              >
                {step.label}
              </Link>
            </li>
          ))}
          {reviewStages?.map((stage) => (
            <li key={stage.id}>
              <Link
                aria-current={current === stage.id ? 'page' : undefined}
                aria-disabled={stage.ready ? undefined : 'true'}
                title={stage.ready ? undefined : stage.reason}
                to={stage.href}
                onClick={(event) => {
                  if (!stage.ready) event.preventDefault();
                }}
              >
                {stage.label}
                {!stage.ready && <span className="journey-locked"> · 待前置</span>}
              </Link>
            </li>
          ))}
          {u3Stages.map((stage) => (
            <li key={stage.id}>
              <Link
                aria-current={current === stage.id ? 'page' : undefined}
                aria-disabled={stage.ready ? undefined : 'true'}
                title={stage.ready ? undefined : stage.reason}
                to={stage.href}
                onClick={(event) => {
                  if (!stage.ready) event.preventDefault();
                }}
              >
                {stage.label}
                {!stage.ready && <span className="journey-locked"> · 待前置</span>}
              </Link>
            </li>
          ))}
        </ul>
        <p className="muted">
          阶段入口按上游模拟定稿启用；直接打开链接不会补造缺失的依据。返工/恢复/交付保留同一项目与精确版本。
        </p>
      </details>
    </nav>
  );
}
