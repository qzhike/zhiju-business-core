import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { presentPreparationReport } from './LiveReport.js';
import { AnalysisPage } from './Page.js';
import { customerRequests, initialState } from './model.js';
const project = '019e0000-0000-7000-8000-000000000002',
  enterprise = '019e0000-0000-7000-8000-000000000001';
// Presentation fixture only; closed wire schemas have independent contract fixtures.
const fixture = (): Record<string, unknown> => ({
  binding: {
    projectRef: {
      objectType: 'zhiju.project.project',
      objectId: project,
      scope: { projectId: project, enterpriseId: enterprise },
    },
    reportRef: {
      objectType: 'zhiju.project.preparation_report',
      objectId: 'synthetic-report',
      scope: { projectId: project, enterpriseId: enterprise },
    },
  },
  content: {
    report: {
      schemaVersion: '0.2.0',
      stage: 'ANALYSIS',
      title: 'Synthetic analysis report',
      summary: 'Synthetic response only',
      limitations: [],
      attentionItems: [],
      evidence: [],
      plannedFiles: [],
      changes: [],
      checks: [],
      resolutionProposals: [],
    },
    narrativeMarkdown: '# Synthetic report',
  },
  currentUsability: { usable: true },
  allowedActions: [],
});
describe('live accepted preparation report', () => {
  it('presents server content without fixture conclusions or execution actions', () => {
    const { report } = presentPreparationReport(fixture(), project, enterprise);
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <AnalysisPage
          report={report}
          state={initialState(report)}
          update={() => {
            /* Static read-only rendering. */
          }}
          historical={false}
          readOnlyActions
          records={null}
        />
      </MemoryRouter>,
    );
    expect(html).toContain('Synthetic analysis report');
    expect(html).not.toContain('提交并分析');
    expect(html).toContain('readOnly=');
    expect(html).toContain('提交尚未接入公开操作');
  });
  it('renders actual customer attention even when v0.2 supplies no separate request script', () => {
    const data = fixture();
    const content = data.content as Record<string, unknown>;
    const source = content.report as Record<string, unknown>;
    source.attentionItems = [
      {
        id: 'missing-manual',
        title: 'Current manual is missing',
        kind: 'MISSING_MATERIAL',
        audience: 'CUSTOMER',
        reason: 'The submitted set does not include the manual',
        question: 'Please provide the current manual',
        affectedPlannedFileIds: [],
        protectedFactIds: [],
        evidenceIds: [],
        customerRequest: null,
      },
    ];
    const { report } = presentPreparationReport(data, project, enterprise);
    expect(customerRequests(report)).toHaveLength(1);
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <AnalysisPage
          report={report}
          state={initialState(report)}
          update={() => undefined}
          historical={false}
          readOnlyActions
          records={null}
        />
      </MemoryRouter>,
    );
    expect(html).toContain('Current manual is missing');
    expect(html).toContain('<strong>1</strong>');
  });
  it('rejects a cross-project or cross-enterprise response', () => {
    expect(() => presentPreparationReport(fixture(), 'other', enterprise)).toThrow(
      'UI_ANALYSIS_INVALID',
    );
    expect(() => presentPreparationReport(fixture(), project, 'other')).toThrow(
      'UI_ANALYSIS_INVALID',
    );
  });
  it('rejects broken nested data instead of coercing it into rendered facts', () => {
    const data = fixture(),
      content = data.content as Record<string, unknown>,
      report = content.report as Record<string, unknown>;
    report.attentionItems = [{ id: 'invalid' }];
    expect(() => presentPreparationReport(data, project, enterprise)).toThrow(
      'UI_ANALYSIS_INVALID',
    );
  });
  it('keeps an expired report readable without making it actionable', () => {
    const data = fixture();
    data.currentUsability = { usable: false, reasonCodes: ['EXPIRED'] };
    expect(presentPreparationReport(data, project, enterprise).usable).toBe(false);
  });
});
