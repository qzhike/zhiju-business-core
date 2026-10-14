import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import initial from '../fixtures/analysis-report.json';
import followup from '../fixtures/analysis-report.followup.json';
import { AnalysisPage } from './Page.js';
import { contextFor, initialState, type AnalysisReport } from './model.js';
const original: AnalysisReport = {
  ...initial,
  projectId: 'project',
  reportId: 'report-1',
  version: 1,
  narrative: '',
  resolutionProposals: [],
};
const current: AnalysisReport = {
  ...followup,
  projectId: 'project',
  reportId: 'report-2',
  version: 2,
  narrative: '',
  resolutionProposals: [],
};
function render(contextReport?: AnalysisReport) {
  const context = contextFor(original, 'CUSTOMER');
  return renderToStaticMarkup(
    <MemoryRouter>
      <AnalysisPage
        report={current}
        contextReport={contextReport}
        state={{ ...initialState(current), context }}
        update={() => {
          // Static rendering does not dispatch presentation actions.
        }}
        historical={false}
        records={null}
      />
    </MemoryRouter>,
  );
}
describe('exact-context analysis evidence', () => {
  it('renders original evidence when a newer report reuses the evidence ID with a different meaning', () => {
    const html = render(original);
    expect(html).toContain('该文件未出现在输入清单');
    expect(html).not.toContain('本轮新增依据另见现行岗位职责文件');
    expect(html).toContain('/projects/project/analysis/report-1');
  });
  it.each([
    ['missing', undefined],
    ['wrong project', { ...original, projectId: 'other-project' }],
    ['wrong report', { ...original, reportId: 'other-report' }],
    ['wrong version', { ...original, version: 2 }],
  ] as const)(
    'shows unavailable original evidence without falling back to current evidence: %s',
    (_reason, source) => {
      const html = render(source);
      expect(html).toContain('原报告依据暂不可用');
      expect(html).not.toContain('该文件未出现在输入清单');
      expect(html).not.toContain('本轮新增依据另见现行岗位职责文件');
      expect(html).toContain('/projects/project/analysis/report-1');
    },
  );
});
