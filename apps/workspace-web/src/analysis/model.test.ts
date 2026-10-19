import { describe, expect, it } from 'vitest';
import initial from '../fixtures/analysis-report.json';
import {
  contextFor,
  customerRequests,
  matchesReceipt,
  requestText,
  type AnalysisReport,
  type Submission,
} from './model.js';
const report: AnalysisReport = {
  ...initial,
  projectId: 'project',
  reportId: 'report',
  version: 1,
  narrative: '',
  resolutionProposals: [],
};
describe('analysis presentation boundaries', () => {
  it('deduplicates supplied customer keys without losing missing/read-limit/fact distinctions or exporting consultant conflicts', () => {
    const requests = customerRequests(report);
    expect(requests).toHaveLength(3);
    expect(requests[0]?.items.map((item) => item.id)).toEqual(['U16', 'U17']);
    expect(requests.map((item) => item.items[0]?.kind)).toEqual([
      'MISSING_MATERIAL',
      'UNREADABLE_MATERIAL',
      'FACT_QUESTION',
    ]);
    expect(requestText(requests)).not.toContain('P03');
    expect(requestText(requests).match(/现行岗位职责文件\n/g)).toHaveLength(1);
  });
  it('keeps customer attention without request text and does not merge it with a supplied key', () => {
    const missing = report.attentionItems.find((item) => item.audience === 'CUSTOMER');
    const consultant = report.attentionItems.find((item) => item.audience === 'CONSULTANT');
    if (!missing || !consultant) throw new Error('Required attention fixture is missing');
    const request = {
      key: `attention-${missing.id}`,
      title: 'Supplied title',
      text: 'Supplied text',
    };
    const mixed = {
      ...report,
      attentionItems: [
        { ...missing, customerRequest: null, question: 'Original missing-document question' },
        { ...missing, id: 'second', customerRequest: request },
        { ...missing, id: 'third', customerRequest: request },
        { ...consultant, customerRequest: null },
      ],
    };
    const requests = customerRequests(mixed);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      title: missing.title,
      text: 'Original missing-document question',
      usesOriginalQuestion: true,
    });
    expect(requests[0]?.items.map((item) => item.id)).toEqual([missing.id]);
    expect(requests[1]?.key).toBe(request.key);
    expect(requests[1]?.items.map((item) => item.id)).toEqual(['second', 'third']);
    expect(requests[0]?.key).not.toBe(requests[1]?.key);
    expect(requestText(requests)).toContain('Original missing-document question');
    expect(requestText(requests)).not.toContain(consultant.question);
  });
  it('binds plan feedback to only the selected file despite shared action/evidence and preserves consultant references', () => {
    const context = contextFor(report, 'PLAN', 'F-CORR');
    expect(context.fileIds).toEqual(['F-CORR']);
    expect(context.changeIds).toEqual(['K-CAPA']);
    expect(context.evidenceIds).toContain('E-PREV');
    const judgment = contextFor(report, 'JUDGMENT', 'P03');
    expect(judgment.itemIds).toEqual(['P03']);
    expect(judgment.protectedFactIds).toEqual(['P-ORG']);
    expect(judgment.reportId).toBe('report');
  });
  it('rejects receipts for a different exact report, project, snapshot or evidence', () => {
    const input: Submission = {
      id: 'intent',
      projectId: 'project',
      context: contextFor(report, 'CUSTOMER'),
      draft: { text: 'Original', attachments: ['source.md'], fixedExample: false },
    };
    const receipt = { input: structuredClone(input), state: 'RECEIVED' as const, message: '' };
    expect(matchesReceipt(input, receipt)).toBe(true);
    for (const altered of [
      { ...input, projectId: 'other' },
      { ...input, context: { ...input.context, reportId: 'other' } },
      { ...input, context: { ...input.context, evidenceIds: [] } },
      { ...input, draft: { ...input.draft, text: 'Next draft' } },
    ])
      expect(matchesReceipt(input, { ...receipt, input: altered })).toBe(false);
  });
});
