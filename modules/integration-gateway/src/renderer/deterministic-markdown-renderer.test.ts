// #270: deterministic Markdown renderer tests. The renderer is Artifact-agnostic;
// round-trip equivalence with the Artifact parser is proven in
// tests/business/markdown-canonical-pipeline.test.ts.

import { describe, expect, it } from 'vitest';

import { markdownDocumentSchemaReference, type Artifact } from '@zhiju/contracts';

import {
  MARKDOWN_RENDERER_PROFILE,
  MarkdownRendererInputError,
  renderMarkdownDocument,
  renderMarkdownInline,
} from './deterministic-markdown-renderer.js';

const ENTERPRISE_ID = '0199b600-0000-7000-8000-00000000e272';
const DOCUMENT_ID = '0199b600-0000-7000-8000-00000000d272';

function content(
  units: readonly Artifact.MarkdownDocumentUnit[],
): Artifact.MarkdownDocumentContent {
  return {
    schemaRef: markdownDocumentSchemaReference(ENTERPRISE_ID),
    contentType: 'STRUCTURED_DOCUMENT',
    canonicalizationVersion: '1',
    body: {
      documentId: DOCUMENT_ID,
      title: 'Rendered document',
      units,
      metadata: { fileKind: 'FILLED_RECORD', fileCode: 'QR-PD-7.4-01' },
    },
  };
}

const section: Artifact.MarkdownSectionUnit = {
  unitId: 's1',
  unitType: 'SECTION',
  ordinal: 0,
  text: 'Heading',
  childUnitIds: ['p1', 'b1', 'l1', 'l2', 't1'],
  semanticMetadata: { markdown: { headingLevel: 2, inlineSpans: [] } },
};
const paragraph: Artifact.MarkdownParagraphTextUnit = {
  unitId: 'p1',
  parentUnitId: 's1',
  unitType: 'PARAGRAPH',
  ordinal: 0,
  text: 'body',
  childUnitIds: [],
  semanticMetadata: {
    markdown: { blockKind: 'TEXT', inlineSpans: [{ start: 0, end: 4, kind: 'STRONG' }] },
  },
};
const thematic: Artifact.MarkdownThematicBreakUnit = {
  unitId: 'b1',
  parentUnitId: 's1',
  unitType: 'PARAGRAPH',
  ordinal: 1,
  childUnitIds: [],
  semanticMetadata: { markdown: { blockKind: 'THEMATIC_BREAK' } },
};
const listItems: Artifact.MarkdownListItemUnit[] = [2, 3].map((ordinal) => ({
  unitId: `l${ordinal - 1}`,
  parentUnitId: 's1',
  unitType: 'PARAGRAPH',
  ordinal,
  text: `item ${ordinal}`,
  childUnitIds: [],
  semanticMetadata: {
    markdown: {
      blockKind: 'LIST_ITEM',
      inlineSpans: [],
      listId: 'list:2',
      listKind: 'ORDERED',
      listOrdinal: ordinal,
      listDepth: 1,
      orderedMarker: `${ordinal}.`,
    },
  },
}));
const table: Artifact.MarkdownTableUnit = {
  unitId: 't1',
  parentUnitId: 's1',
  unitType: 'TABLE',
  ordinal: 4,
  childUnitIds: ['t1r0', 't1r1'],
  semanticMetadata: {
    markdown: {
      columns: [
        { columnId: 'c0', ordinal: 0, alignment: 'LEFT' },
        { columnId: 'c1', ordinal: 1, alignment: 'RIGHT' },
      ],
      headerRowUnitId: 't1r0',
    },
  },
};
const tableRow = (row: number, role: 'HEADER' | 'DATA'): Artifact.MarkdownTableRowUnit => ({
  unitId: `t1r${row}`,
  parentUnitId: 't1',
  unitType: 'TABLE_ROW',
  ordinal: row,
  childUnitIds: [`t1r${row}c0`, `t1r${row}c1`],
  semanticMetadata: { markdown: { rowRole: role } },
});
const tableCell = (
  row: number,
  column: number,
  valueState: 'BLANK' | 'TEXT',
): Artifact.MarkdownBlankTableCellUnit | Artifact.MarkdownTextTableCellUnit =>
  valueState === 'BLANK'
    ? {
        unitId: `t1r${row}c${column}`,
        parentUnitId: `t1r${row}`,
        unitType: 'TABLE_CELL',
        ordinal: column,
        childUnitIds: [],
        semanticMetadata: {
          markdown: { columnId: `c${column}`, valueState: 'BLANK', inlineSpans: [] },
        },
      }
    : {
        unitId: `t1r${row}c${column}`,
        parentUnitId: `t1r${row}`,
        unitType: 'TABLE_CELL',
        ordinal: column,
        text: column === 0 ? 'a | b' : '0',
        childUnitIds: [],
        semanticMetadata: {
          markdown: {
            columnId: `c${column}`,
            valueState: 'TEXT',
            inlineSpans: [],
          },
        },
      };

const fullDocument = content([
  section,
  paragraph,
  thematic,
  ...listItems,
  table,
  tableRow(0, 'HEADER'),
  tableCell(0, 0, 'TEXT'),
  tableCell(0, 1, 'TEXT'),
  tableRow(1, 'DATA'),
  tableCell(1, 0, 'BLANK'),
  tableCell(1, 1, 'TEXT'),
]);

function expectError(action: () => unknown, code: string): void {
  try {
    action();
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(MarkdownRendererInputError);
    expect((error as MarkdownRendererInputError).code).toBe(code);
  }
}

describe('markdown renderer profile', () => {
  it('fixes the markdown-only output format and media type', () => {
    expect(MARKDOWN_RENDERER_PROFILE).toEqual({
      outputFormat: 'zhiju.markdown',
      rendererId: 'zhiju.renderer.markdown.canonical',
      rendererVersion: '1.0.0',
      mediaType: 'text/markdown; charset=utf-8',
      extension: 'md',
      contentType: 'STRUCTURED_DOCUMENT',
    });
  });
});

describe('inline rendering', () => {
  it('escapes markdown control characters without changing the plain text', () => {
    expect(renderMarkdownInline('*a* `b` |c| <d> #e =f ~g', [])).toBe(
      '\\*a\\* \\`b\\` \\|c\\| \\<d\\> \\#e \\=f \\~g',
    );
  });

  it('renders strong, emphasis, combined and code spans', () => {
    expect(renderMarkdownInline('abcd', [{ start: 0, end: 4, kind: 'STRONG' }])).toBe('**abcd**');
    expect(renderMarkdownInline('abcd', [{ start: 1, end: 3, kind: 'EMPHASIS' }])).toBe('a*bc*d');
    expect(
      renderMarkdownInline('ab', [
        { start: 0, end: 2, kind: 'STRONG' },
        { start: 0, end: 2, kind: 'EMPHASIS' },
      ]),
    ).toBe('***ab***');
    expect(renderMarkdownInline('ab', [{ start: 0, end: 2, kind: 'CODE' }])).toBe('`ab`');
  });

  it('fences inline code longer than any backtick run inside it', () => {
    expect(renderMarkdownInline('a`b', [{ start: 0, end: 3, kind: 'CODE' }])).toBe('``a`b``');
  });

  it('renders a hard break as the allowlisted br token', () => {
    expect(renderMarkdownInline('a\nb', [{ start: 1, end: 2, kind: 'HARD_BREAK' }])).toBe('a<br>b');
  });

  it('rejects leading whitespace that canonical Markdown cannot carry', () => {
    expectError(() => renderMarkdownInline(' leading', []), 'INTEGRATION_MARKDOWN_RENDER_INVALID');
  });
});

describe('document rendering', () => {
  it('renders the closed block grammar deterministically', () => {
    const first = renderMarkdownDocument(fullDocument);
    const second = renderMarkdownDocument(fullDocument);
    expect(first.bytes.toString('utf8')).toBe(second.bytes.toString('utf8'));
    expect(first.checksum.digest).toBe(second.checksum.digest);
    expect(first.bytes.toString('utf8')).toBe(
      [
        '## Heading',
        '',
        '**body**',
        '',
        '---',
        '',
        '2. item 2',
        '3. item 3',
        '',
        '| a \\| b | 0 |',
        '| :--- | ---: |',
        '|  | 0 |',
        '',
      ].join('\n'),
    );
  });

  it('rejects content that is not a closed Markdown document', () => {
    // Deliberately invalid for the closed schema; the cast only expresses intent.
    const broken = {
      ...fullDocument,
      body: {
        ...fullDocument.body,
        metadata: {
          fileKind: 'UNKNOWN' as Artifact.MarkdownDocumentMetadata['fileKind'],
          fileCode: 'x',
        },
      },
    };
    expectError(() => renderMarkdownDocument(broken), 'INTEGRATION_RENDER_INPUT_MISMATCH');
  });
});
