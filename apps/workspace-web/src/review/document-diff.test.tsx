import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { documentDiff, documentLines, splitDiff, type DocumentLine } from './document-diff.js';
import { FullDocumentDiff } from './FullDocumentDiff.js';
import { u2CandidateComparison } from '../fixtures/u2-data.js';
import type { Document, Unit } from '../trusted/markdown.js';

const lines = (values: string[]): DocumentLine[] =>
  values.map((text, index) => ({ number: index + 1, text, unitIds: [`u${index}`] }));

describe('full document alignment', () => {
  it.each([
    [
      ['unchanged', 'old', 'tail'],
      ['unchanged', 'new', 'tail'],
    ],
    [
      ['repeat', 'repeat', 'last'],
      ['repeat', 'insert', 'repeat', 'last'],
    ],
    [
      ['a', 'b', 'c'],
      ['c', 'a', 'b'],
    ],
    [[], ['created']],
    [['removed'], []],
    [['same'], ['same']],
  ])('preserves both complete documents in unified and split layouts', (before, after) => {
    const result = documentDiff(lines(before), lines(after));
    for (const rows of [result.lines, splitDiff(result.lines)]) {
      expect(rows.flatMap((row) => (row.before ? [row.before.text] : []))).toEqual(before);
      expect(rows.flatMap((row) => (row.after ? [row.after.text] : []))).toEqual(after);
    }
  });

  it('keeps unchanged context and distinguishes removed/added lines', () => {
    const diff = documentDiff(
      lines(['heading', 'before', 'tail']),
      lines(['heading', 'after', 'tail']),
    );
    expect(diff.lines.map((line) => line.kind)).toEqual(['context', 'removed', 'added', 'context']);
    expect(splitDiff(diff.lines)[1]).toMatchObject({
      before: { number: 2, text: 'before' },
      after: { number: 2, text: 'after' },
    });
  });

  it('bounds expensive alignment without dropping long document content', () => {
    const before = lines(Array.from({ length: 1100 }, (_, index) => `old ${index}`));
    const after = lines(Array.from({ length: 1100 }, (_, index) => `new ${index}`));
    const diff = documentDiff(before, after);
    expect(diff.coarse).toBe(true);
    expect(splitDiff(diff.lines).map((line) => line.before)).toEqual(before);
    expect(splitDiff(diff.lines).map((line) => line.after)).toEqual(after);
  });
});

describe('normalized document reading', () => {
  it('retains every section, paragraph and table cell from the exact fixture versions', () => {
    const data = u2CandidateComparison('F-MANUAL', 'V1', 'V2');
    expect(data?.before).toBeDefined();
    for (const content of [data?.before, data?.content]) {
      if (!content) throw new Error('Missing comparison fixture');
      const normalized = documentLines(content.document);
      const source = normalized.map((line) => line.text).join('\n');
      for (const unit of content.document.units) {
        if (unit.text) expect(source).toContain(unit.text);
      }
      expect(normalized.map((line) => line.number)).toEqual(
        normalized.map((_, index) => index + 1),
      );
    }
  });

  it('preserves nested lists, Unicode inline formatting and hard breaks', () => {
    const parent: Unit = {
      unitId: 's',
      unitType: 'SECTION',
      ordinal: 0,
      childUnitIds: ['p'],
      text: '标题',
      semanticMetadata: { markdown: { headingLevel: 2 } },
    };
    const child: Unit = {
      unitId: 'p',
      parentUnitId: 's',
      unitType: 'PARAGRAPH',
      ordinal: 0,
      childUnitIds: [],
      text: '中文🙂换行',
      semanticMetadata: {
        markdown: {
          blockKind: 'LIST_ITEM',
          listKind: 'ORDERED',
          orderedMarker: '2.',
          listDepth: 1,
          inlineSpans: [
            { start: 0, end: 3, kind: 'STRONG' },
            { start: 3, end: 4, kind: 'HARD_BREAK' },
          ],
        },
      },
    };
    const document: Document = { documentId: 'd', title: 'Title', units: [child, parent] };
    const result = documentLines(document);
    expect(result.map((line) => line.text)).toEqual(['## 标题', '', '  2. **中文🙂**', '行', '']);
    expect(result[2]?.unitIds).toEqual(['p', 's']);
  });

  it('shows whole content safely and refuses unavailable or mismatched baselines', () => {
    const data = u2CandidateComparison('F-MANUAL', 'V1', 'V2');
    if (!data?.before) throw new Error('Missing comparison fixture');
    const render = (value: typeof data) =>
      renderToStaticMarkup(
        <FullDocumentDiff data={value} narrow={false} activeIndex={0} navigationRequest={0} />,
      );
    expect(render(data)).toContain('全文显示，包含未修改内容');
    const missing = { ...data };
    delete missing.before;
    expect(render(missing)).toContain('比较基线正文尚不可用');
    expect(render({ ...data, before: data.content })).toContain('精确版本不一致');
    const unsafe = {
      ...data,
      content: {
        ...data.content,
        document: {
          ...data.content.document,
          units: [
            {
              unitId: 'unsafe',
              unitType: 'PARAGRAPH' as const,
              ordinal: 0,
              semanticMetadata: { markdown: {} },
              childUnitIds: [],
              text: '<script>alert(1)</script>',
            },
          ],
        },
      },
    };
    expect(render(unsafe)).not.toContain('<script>');
    expect(render(unsafe)).toContain('&lt;script&gt;');
  });

  it('labels a genuinely empty original without inventing baseline text', () => {
    const data = u2CandidateComparison('F-EXTERNAL-RULE', null, 'V1');
    if (!data) throw new Error('Missing new-file fixture');
    const markup = renderToStaticMarkup(
      <FullDocumentDiff data={data} narrow activeIndex={0} navigationRequest={0} />,
    );
    expect(markup).toContain('无客户原版本');
    expect(markup).toContain('data-layout="unified"');
    expect(markup).not.toContain('is-removed');
  });
});
