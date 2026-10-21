import { Link } from 'react-router';

const base = '/projects/MVP-U1-PROJECT';
const steps = [
  { id: 'overview', label: '项目概览', path: `${base}/overview` },
  { id: 'intake', label: '资料批次', path: `${base}/intake` },
  { id: 'analysis', label: '分析与澄清', path: `${base}/analysis/U1-REPORT-01` },
  { id: 'scope', label: '修改范围', path: `${base}/startup/U1-REPORT-02` },
] as const;
export function JourneyNav({
  current,
  analysisReportId,
  scopeEnabled,
}: {
  current: (typeof steps)[number]['id'];
  analysisReportId: string;
  scopeEnabled: boolean;
}) {
  return (
    <nav className="journey-nav" aria-label="同一项目的页面路径">
      <p className="muted">
        同一项目 MVP-U1-PROJECT · 页面路径不是业务阶段；访问页面不改变阶段完成状态。
      </p>
      <ol>
        {steps.map((step) => (
          <li key={step.id}>
            <Link
              aria-current={current === step.id ? 'page' : undefined}
              to={
                step.id === 'analysis'
                  ? `/projects/MVP-U1-PROJECT/analysis/${analysisReportId}`
                  : step.path
              }
              aria-disabled={step.id === 'scope' && !scopeEnabled ? 'true' : undefined}
              onClick={(event) => {
                if (step.id === 'scope' && !scopeEnabled) event.preventDefault();
              }}
            >
              {step.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
