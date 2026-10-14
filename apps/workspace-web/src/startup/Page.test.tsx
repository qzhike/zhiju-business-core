import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import startup from '../fixtures/startup-review.json';
import type { ReportView } from '../model.js';
import { StartupPage } from './Page.js';

const report: ReportView = {
  projectId: 'DEMO-PROJECT-01',
  reportId: startup.reportKey,
  version: 1,
  title: '合成报告',
  summary: '',
  narrative: '',
  limitations: [],
  attention: [],
  information: startup.information,
  files: startup.files,
};

function render(
  options: {
    selected?: string[];
    unavailable?: Record<string, string>;
    startupBlocker?: string;
    prior?: { requestId: string; reportId: string; version: number; fileIds: string[] }[];
    latestReportId?: string;
    status?: 'READY' | 'PENDING' | 'UNKNOWN';
  } = {},
) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <StartupPage
        report={report}
        selected={options.selected ?? []}
        unavailable={options.unavailable ?? {}}
        startupBlocker={options.startupBlocker}
        prior={options.prior ?? []}
        latestReportId={options.latestReportId ?? report.reportId}
        status={options.status}
        onSelectionChange={() => {
          // Static rendering does not dispatch actions.
        }}
        onConfirm={() => {
          // Static rendering does not dispatch actions.
        }}
        onPlanOpinion={() => {
          // Static rendering does not dispatch actions.
        }}
      />
    </MemoryRouter>,
  );
}

describe('startup scope presentation', () => {
  it('starts empty and names the whole-file reason with the disabled checkbox', () => {
    const html = render();
    expect(html).toContain('已选 0 / 2 份');
    expect(html).toContain('暂不能处理');
    expect(html).toContain('aria-describedby="scope-reason-DEMO-MANUAL"');
    expect(html).toContain('组织图未可靠读取');
    expect(html).toContain('disabled=""');
  });

  it('preserves selection but blocks confirmation for missing startup evidence and pending results', () => {
    const missing = render({ selected: ['DEMO-CORR'], startupBlocker: '缺少产品范围依据' });
    expect(missing).toContain('已选 1 / 2 份');
    expect(missing).toContain('缺少产品范围依据');
    expect(missing).toContain('disabled=""');
    expect(render({ selected: ['DEMO-CORR'], status: 'UNKNOWN' })).toContain('不能再次提交');
  });

  it('excludes an included file while keeping its exact round link', () => {
    const html = render({
      prior: [
        { requestId: 'request-1', reportId: report.reportId, version: 1, fileIds: ['DEMO-CORR'] },
      ],
    });
    expect(html).toContain('已选 0 / 1 份');
    expect(html).toContain('已纳入第 1 版范围');
    expect(html).toContain('/projects/DEMO-PROJECT-01/executions/request-1');
  });
});
