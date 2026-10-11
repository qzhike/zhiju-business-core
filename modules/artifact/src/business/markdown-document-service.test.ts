// #270: closed Markdown parse/canonicalize/identity tests for the
// `artifact.markdown_document@1.0` profile. Identifiers are controlled test-only
// values; they do not assert a submitted intent or a prepared source mapping.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { markdownDocumentSchemaReference, type Artifact, type Common } from '@zhiju/contracts';

import {
  buildMarkdownIdentityMap,
  MARKDOWN_PARSER_PROFILE,
  parseMarkdownDocument,
  type MarkdownIdentityBinding,
  type MarkdownParseResult,
} from './markdown-document-service.js';

const ENTERPRISE_ID = '0199b600-0000-7000-8000-00000000e271';
const DOCUMENT_ID = '0199b600-0000-7000-8000-00000000d271';
const ARTIFACT_ID = '0199b600-0000-7000-8000-00000000a271';
const PROJECT_ID = '0199b600-0000-7000-8000-00000000c271';
const DERIVATION = {
  originalIntentRef: 'ISSUE_270_CONTROLLED_TEST_ONLY:intent',
  candidateOutputId: 'candidate-1',
} as const;

function fixture(name: string): Uint8Array {
  return readFileSync(new URL(`../../../../tests/fixtures/markdown/${name}`, import.meta.url));
}

function template(name: string): Uint8Array {
  return readFileSync(
    new URL(`../../../../.vibe/prototypes/workspace-mvp/templates/${name}`, import.meta.url),
  );
}

function parseInput(
  bytes: Uint8Array,
  overrides: Partial<Parameters<typeof parseMarkdownDocument>[0]> = {},
): MarkdownParseResult {
  return parseMarkdownDocument({
    bytes,
    enterpriseId: ENTERPRISE_ID,
    documentId: DOCUMENT_ID,
    title: 'Controlled document',
    documentMetadata: { fileKind: 'BLANK_FORM', fileCode: 'QR-PD-7.4-01' },
    identityDerivation: DERIVATION,
    ...overrides,
  });
}

function parseText(
  text: string,
  overrides: Partial<Parameters<typeof parseMarkdownDocument>[0]> = {},
): MarkdownParseResult {
  return parseInput(Buffer.from(text, 'utf8'), overrides);
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    expect.unreachable();
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
  }
}

/** Validated closed metadata of one unit (the registry validator proved the shape). */
function markdownMetadata(unit: Artifact.MarkdownDocumentUnit): Record<string, unknown> {
  return (unit.semanticMetadata as { markdown: Record<string, unknown> }).markdown;
}

function unitText(unit: Artifact.MarkdownDocumentUnit): string | undefined {
  return (unit as { text?: string }).text;
}

function defined<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function textUnits(units: readonly Artifact.MarkdownDocumentUnit[]): string[] {
  return units.map((unit) => unitText(unit)).filter((text): text is string => text !== undefined);
}

describe('markdown profile registration', () => {
  it('fixes the markdown parser profile identity', () => {
    expect(MARKDOWN_PARSER_PROFILE).toEqual({
      profileKey: 'artifact.markdown_document@1.0',
      registryKey: 'artifact.markdown_document.schema@1.0',
      parserId: 'zhiju.parser.markdown.canonical',
      parserVersion: '1.0.0',
    });
  });
});

describe('heading structure', () => {
  it('keeps two H1 headings as independent root sections', () => {
    const parsed = parseText('# First\n\n# Second\n');
    const sections = parsed.content.body.units.filter((unit) => unit.unitType === 'SECTION');
    expect(sections).toHaveLength(2);
    expect(sections.every((section) => section.parentUnitId === undefined)).toBe(true);
    expect(markdownMetadata(sections[1] as Artifact.MarkdownDocumentUnit).headingLevel).toBe(1);
  });

  it('nests sections by the ATX heading level stack without merging equal titles', () => {
    const parsed = parseText('# A\n\n## B\n\n### C\n\n## D\n');
    const byText = new Map(
      parsed.content.body.units
        .filter((unit) => unit.unitType === 'SECTION')
        .map((unit) => [unitText(unit), unit] as const),
    );
    expect(byText.get('A')?.parentUnitId).toBeUndefined();
    expect(byText.get('B')?.parentUnitId).toBe(byText.get('A')?.unitId);
    expect(byText.get('C')?.parentUnitId).toBe(byText.get('B')?.unitId);
    expect(byText.get('D')?.parentUnitId).toBe(byText.get('A')?.unitId);
  });
});

describe('lists', () => {
  it('keeps original ordered markers and ordinals', () => {
    const parsed = parseText('3. three\n4. four\n');
    const items = parsed.content.body.units.filter(
      (unit) => markdownMetadata(unit).blockKind === 'LIST_ITEM',
    );
    expect(items.map((item) => markdownMetadata(item).orderedMarker)).toEqual(['3.', '4.']);
    expect(items.map((item) => markdownMetadata(item).listOrdinal)).toEqual([3, 4]);
    expect(new Set(items.map((item) => markdownMetadata(item).listId)).size).toBe(1);
  });

  it('models indented sub-lists as list-depth children', () => {
    const parsed = parseText('- parent\n  - child\n- sibling\n');
    const items = parsed.content.body.units.filter(
      (unit) => markdownMetadata(unit).blockKind === 'LIST_ITEM',
    );
    expect(items).toHaveLength(3);
    const child = items.find((item) => unitText(item) === 'child');
    const parent = items.find((item) => unitText(item) === 'parent');
    expect(child?.parentUnitId).toBe(parent?.unitId);
    expect(markdownMetadata(defined(child, 'child item')).listDepth).toBe(2);
    expect(markdownMetadata(defined(parent, 'parent item')).listDepth).toBe(1);
  });

  it('joins an indented continuation line into the current item text', () => {
    const parsed = parseText('- first\n  5.1 continuation\n');
    const item = parsed.content.body.units.find(
      (unit) => markdownMetadata(unit).blockKind === 'LIST_ITEM',
    );
    expect(unitText(defined(item, 'list item'))).toBe('first 5.1 continuation');
  });
});

describe('tables', () => {
  it('distinguishes a blank cell from the text "0"', () => {
    const parsed = parseInput(fixture('blank-versus-zero.md'));
    const cells = parsed.content.body.units.filter((unit) => unit.unitType === 'TABLE_CELL');
    const blank = cells.filter((cell) => markdownMetadata(cell).valueState === 'BLANK');
    expect(blank.length).toBeGreaterThan(0);
    expect(blank.every((cell) => unitText(cell) === undefined)).toBe(true);
    const zero = cells.find((cell) => unitText(cell) === '0');
    expect(zero).toBeDefined();
    expect(markdownMetadata(zero as Artifact.MarkdownDocumentUnit).valueState).toBe('TEXT');
  });

  it('keeps per-column alignment and every real row and cell identity', () => {
    const parsed = parseText(
      '| a | b | c | d |\n|:--|:-:|--:|---|\n| 1 | 2 | 3 | 4 |\n|  |  |  |  |\n',
    );
    const table = parsed.content.body.units.find((unit) => unit.unitType === 'TABLE');
    const columns = markdownMetadata(table as Artifact.MarkdownDocumentUnit)
      .columns as readonly Artifact.MarkdownTableColumn[];
    expect(columns.map((column) => column.alignment)).toEqual(['LEFT', 'CENTER', 'RIGHT', 'NONE']);
    expect(columns.map((column) => column.ordinal)).toEqual([0, 1, 2, 3]);
    const rows = parsed.content.body.units.filter((unit) => unit.unitType === 'TABLE_ROW');
    expect(rows.map((row) => markdownMetadata(row).rowRole)).toEqual(['HEADER', 'DATA', 'DATA']);
    const cells = parsed.content.body.units.filter((unit) => unit.unitType === 'TABLE_CELL');
    expect(cells).toHaveLength(12);
  });

  it('accepts the two-hyphen separator cells of the real application form', () => {
    const parsed = parseInput(template('application.md'));
    const separators = parsed.content.body.units.filter((unit) => unit.unitType === 'TABLE');
    expect(separators.length).toBeGreaterThan(0);
    expect(parsed.rawBytesSha256.digest).toBe(
      '7aa43bee9d0de81093b3f472f6ac27a461e2952fb932846c579f96c18087e42b',
    );
  });

  it('keeps escaped pipes as cell text', () => {
    const parsed = parseInput(fixture('escaped-pipes.md'));
    const texts = textUnits(
      parsed.content.body.units.filter((unit) => unit.unitType === 'TABLE_CELL'),
    );
    expect(texts).toContain('a | b');
    expect(texts).toContain('c | d | e');
    expect(texts).toContain('| 起始');
  });
});

describe('inline grammar', () => {
  it('maps every allowlisted hard break to one LF code point', () => {
    const parsed = parseText('a<br>b\n\nc  \nd\n\ne\\\nf\n');
    const paragraphs = parsed.content.body.units.filter(
      (unit) => markdownMetadata(unit).blockKind === 'TEXT',
    );
    expect(paragraphs.map((unit) => unitText(unit))).toEqual(['a\nb', 'c\nd', 'e\nf']);
    for (const paragraph of paragraphs) {
      const text = unitText(paragraph) ?? '';
      const spans = markdownMetadata(paragraph)
        .inlineSpans as readonly Artifact.MarkdownInlineSpan[];
      expect(spans.map((span) => span.kind)).toEqual(['HARD_BREAK']);
      expect(text[spans[0]?.start ?? 0]).toBe('\n');
    }
  });

  it('keeps strong, emphasis and inline code spans closed and ordered', () => {
    const parsed = parseText('**bold** and *emphasis* and `code`\n');
    const paragraph = parsed.content.body.units.find((unit) => unit.unitType === 'PARAGRAPH');
    const metadata = markdownMetadata(paragraph as Artifact.MarkdownDocumentUnit);
    expect(unitText(paragraph as Artifact.MarkdownDocumentUnit)).toBe('bold and emphasis and code');
    expect(
      (metadata.inlineSpans as readonly Artifact.MarkdownInlineSpan[]).map((span) => span.kind),
    ).toEqual(['STRONG', 'EMPHASIS', 'CODE']);
  });

  it('combines strong and emphasis on one interval for a triple marker', () => {
    const parsed = parseText('***both***\n');
    const paragraph = parsed.content.body.units.find((unit) => unit.unitType === 'PARAGRAPH');
    const spans = markdownMetadata(paragraph as Artifact.MarkdownDocumentUnit)
      .inlineSpans as readonly Artifact.MarkdownInlineSpan[];
    expect(spans.map((span) => span.kind)).toEqual(['STRONG', 'EMPHASIS']);
    expect([spans[0]?.start, spans[0]?.end]).toEqual([spans[1]?.start, spans[1]?.end]);
  });

  it('keeps an unmatched marker as literal text instead of guessing a format', () => {
    const parsed = parseText('unmatched **marker\n');
    const paragraph = parsed.content.body.units.find((unit) => unit.unitType === 'PARAGRAPH');
    expect(unitText(paragraph as Artifact.MarkdownDocumentUnit)).toBe('unmatched **marker');
    expect(markdownMetadata(paragraph as Artifact.MarkdownDocumentUnit).inlineSpans).toEqual([]);
  });

  it('maps a thematic break to a unit without text', () => {
    const parsed = parseText('before\n\n---\n\nafter\n');
    const breaks = parsed.content.body.units.filter(
      (unit) => markdownMetadata(unit).blockKind === 'THEMATIC_BREAK',
    );
    expect(breaks).toHaveLength(1);
    expect(unitText(defined(breaks[0], 'thematic break'))).toBeUndefined();
  });
});

describe('unicode and raw bytes', () => {
  it('preserves placeholders, check marks and mixed width text without NFKC folding', () => {
    const parsed = parseInput(fixture('unicode-placeholders.md'));
    const texts = textUnits(parsed.content.body.units);
    expect(texts.some((text) => text.includes('□Ⅱ类'))).toBe(true);
    expect(texts.some((text) => text.includes('2026-08-30'))).toBe(true);
  });

  it('treats CRLF and BOM as derived normalization while the raw hash stays distinct', () => {
    const lf = Buffer.from('# T\n\nbody\n', 'utf8');
    const crlfBom = Buffer.from('\uFEFF# T\r\n\r\nbody\r\n', 'utf8');
    const parsedLf = parseInput(lf);
    const parsedCrlf = parseInput(crlfBom);
    expect(parsedCrlf.contentHash.digest).toBe(parsedLf.contentHash.digest);
    expect(parsedCrlf.rawBytesSha256.digest).not.toBe(parsedLf.rawBytesSha256.digest);
    expect(parsedCrlf.rawBytesSha256.digest).toBe(
      createHash('sha256').update(crlfBom).digest('hex'),
    );
  });
});

describe('closed rejection set', () => {
  const cases: readonly { name: string; code: string }[] = [
    { name: 'ragged-table.md', code: 'ARTIFACT_MARKDOWN_UNSUPPORTED' },
    { name: 'unsafe-html.md', code: 'ARTIFACT_MARKDOWN_UNSAFE' },
    { name: 'unsafe-link.md', code: 'ARTIFACT_MARKDOWN_UNSAFE' },
    { name: 'front-matter.md', code: 'ARTIFACT_MARKDOWN_UNSUPPORTED' },
    { name: 'code-fence.md', code: 'ARTIFACT_MARKDOWN_UNSUPPORTED' },
    { name: 'blockquote.md', code: 'ARTIFACT_MARKDOWN_UNSUPPORTED' },
    { name: 'nested-formatting.md', code: 'ARTIFACT_MARKDOWN_UNSUPPORTED' },
    { name: 'footnote.md', code: 'ARTIFACT_MARKDOWN_UNSUPPORTED' },
    { name: 'malformed-utf8.md', code: 'ARTIFACT_MARKDOWN_UNSUPPORTED' },
    { name: 'unsupported-extension.md', code: 'ARTIFACT_MARKDOWN_UNSUPPORTED' },
    { name: 'task-list.md', code: 'ARTIFACT_MARKDOWN_UNSUPPORTED' },
  ];

  for (const testCase of cases) {
    it(`rejects ${testCase.name}`, () => {
      expectCode(() => parseInput(fixture(testCase.name)), testCase.code);
    });
  }

  it('rejects indented code blocks and setext headings', () => {
    expectCode(() => parseText('    indented code\n'), 'ARTIFACT_MARKDOWN_UNSUPPORTED');
    expectCode(() => parseText('Title\n===\n'), 'ARTIFACT_MARKDOWN_UNSUPPORTED');
    expectCode(() => parseText('Title\n---\n'), 'ARTIFACT_MARKDOWN_UNSUPPORTED');
  });
});

describe('approved limits', () => {
  it('rejects a table wider than the approved column budget', () => {
    const columns = Array.from({ length: 129 }, (_, index) => `c${index}`);
    const row = `| ${columns.join(' | ')} |`;
    const separator = `| ${columns.map(() => '---').join(' | ')} |`;
    expectCode(() => parseText(`${row}\n${separator}\n${row}\n`), 'ARTIFACT_MARKDOWN_LIMIT');
  });

  it('rejects logical text above the approved code point budget', () => {
    expectCode(() => parseText(`${'x'.repeat(65_537)}\n`), 'ARTIFACT_MARKDOWN_LIMIT');
  });

  it('rejects a list nested deeper than the approved block depth', () => {
    const lines = [0, 2, 4, 6, 8, 10, 12].map((indent) => `${' '.repeat(indent)}- item`);
    expectCode(() => parseText(`${lines.join('\n')}\n`), 'ARTIFACT_MARKDOWN_LIMIT');
  });

  it('rejects a Markdown file above the approved byte budget', () => {
    expectCode(() => parseInput(Buffer.alloc(10_485_761, 0x61)), 'ARTIFACT_MARKDOWN_LIMIT');
  });

  it('rejects a table-heavy file above the total Unit budget', () => {
    // Each 9-byte table occupies 3 Units (table + row + cell) and stays within
    // the per-table column/row limits; ~33.4k tables exceed 100,000 Units in
    // ~300 KB, well below the byte budget.
    const table = '|a|\n|-|\n\n';
    expectCode(() => parseText(table.repeat(33_335)), 'ARTIFACT_MARKDOWN_LIMIT');
  });
});

describe('identity sidecar', () => {
  const ARTIFACT_REF = {
    kind: 'OBJECT',
    objectType: 'artifact.artifact',
    objectId: ARTIFACT_ID,
    scope: { enterpriseId: ENTERPRISE_ID, projectId: PROJECT_ID },
  } as Common.ObjectRef;
  const BINDING: MarkdownIdentityBinding = { artifactRef: ARTIFACT_REF };
  const BASE_REVISION = {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'artifact.artifact_revision',
    objectId: '0199b600-0000-7000-8000-00000000f001',
    scope: { enterpriseId: ENTERPRISE_ID, projectId: PROJECT_ID },
    contentHash: { algorithm: 'SHA-256', canonicalizationVersion: '1', digest: 'b'.repeat(64) },
  } as Common.ContentAddressedRef;
  const SOURCE_MAPPING = {
    kind: 'SNAPSHOT',
    objectType: 'artifact.markdown_source_mapping',
    objectId: '0199b600-0000-7000-8000-00000000f002',
    scope: { enterpriseId: ENTERPRISE_ID, projectId: PROJECT_ID },
    snapshotId: '0199b600-0000-7000-8000-00000000f003',
    contentHash: { algorithm: 'SHA-256', canonicalizationVersion: '1', digest: 'c'.repeat(64) },
  } as Common.SnapshotRef;

  function identityMap(
    parsed: MarkdownParseResult,
    overrides: Partial<Artifact.MarkdownIdentityMap> = {},
  ): Artifact.MarkdownIdentityMap {
    return {
      ...buildMarkdownIdentityMap({
        parse: parsed,
        artifactRef: ARTIFACT_REF,
        profileRef: markdownDocumentSchemaReference(ENTERPRISE_ID),
      }),
      ...overrides,
    };
  }

  const source = '# T\n\n| a | b |\n|---|---|\n| 0 |  |\n\n- one\n- two\n';

  it('inherits every identity from the exact sidecar and owning binding', () => {
    const first = parseText(source);
    const second = parseText(source, {
      identityDerivation: {
        originalIntentRef: 'other',
        candidateOutputId: DERIVATION.candidateOutputId,
      },
      identityMap: identityMap(first),
      identityBinding: BINDING,
    });
    expect(second.content.body.units.map((unit) => unit.unitId)).toEqual(
      first.content.body.units.map((unit) => unit.unitId),
    );
    expect(second.contentHash.digest).toBe(first.contentHash.digest);
  });

  it('requires the expected owning binding whenever a sidecar is supplied', () => {
    const first = parseText(source);
    expectCode(
      () => parseText(source, { identityMap: identityMap(first) }),
      'ARTIFACT_MARKDOWN_IDENTITY_INVALID',
    );
  });

  it('rejects a sidecar for another Artifact, Project or candidate output', () => {
    const first = parseText(source);
    const map = identityMap(first);
    expectCode(
      () =>
        parseText(source, {
          identityMap: map,
          identityBinding: {
            artifactRef: { ...ARTIFACT_REF, objectId: '0199b600-0000-7000-8000-00000000a999' },
          },
        }),
      'ARTIFACT_MARKDOWN_IDENTITY_INVALID',
    );
    expectCode(
      () =>
        parseText(source, {
          identityMap: map,
          identityBinding: {
            artifactRef: {
              ...ARTIFACT_REF,
              scope: {
                enterpriseId: ENTERPRISE_ID,
                projectId: '0199b600-0000-7000-8000-00000000c999',
              },
            },
          },
        }),
      'ARTIFACT_MARKDOWN_IDENTITY_INVALID',
    );
    expectCode(
      () =>
        parseText(source, {
          identityDerivation: { ...DERIVATION, candidateOutputId: 'another-output' },
          identityMap: map,
          identityBinding: BINDING,
        }),
      'ARTIFACT_MARKDOWN_IDENTITY_INVALID',
    );
  });

  it('rejects an unexpected or missing base revision and source mapping', () => {
    const first = parseText(source);
    expectCode(
      () =>
        parseText(source, {
          identityMap: identityMap(first, { baseRevisionRef: BASE_REVISION }),
          identityBinding: BINDING,
        }),
      'ARTIFACT_MARKDOWN_IDENTITY_INVALID',
    );
    expectCode(
      () =>
        parseText(source, {
          identityMap: identityMap(first),
          identityBinding: { ...BINDING, baseRevisionRef: BASE_REVISION },
        }),
      'ARTIFACT_MARKDOWN_IDENTITY_INVALID',
    );
    expectCode(
      () =>
        parseText(source, {
          identityMap: identityMap(first, { baselineMappingRef: SOURCE_MAPPING }),
          identityBinding: BINDING,
        }),
      'ARTIFACT_MARKDOWN_IDENTITY_INVALID',
    );
    const accepted = parseText(source, {
      identityMap: identityMap(first, {
        baseRevisionRef: BASE_REVISION,
        baselineMappingRef: SOURCE_MAPPING,
      }),
      identityBinding: {
        ...BINDING,
        baseRevisionRef: BASE_REVISION,
        baselineMappingRef: SOURCE_MAPPING,
      },
    });
    expect(accepted.contentHash.digest).toBe(first.contentHash.digest);
  });

  it('rejects a sidecar whose raw byte binding does not match', () => {
    const first = parseText(source);
    expectCode(
      () =>
        parseText(source, {
          identityMap: identityMap(first, {
            markdownBytesSha256: { ...first.rawBytesSha256, digest: 'f'.repeat(64) },
          }),
          identityBinding: BINDING,
        }),
      'ARTIFACT_MARKDOWN_IDENTITY_INVALID',
    );
  });

  it('rejects a sidecar with a wrong declared type, parent or ordinal', () => {
    const first = parseText(source);
    expectCode(
      () =>
        parseText(source, {
          identityMap: identityMap(first, {
            nodes: identityMap(first).nodes.map((node, index) =>
              index === 1 ? { ...node, type: 'TABLE' as const } : node,
            ),
          }),
          identityBinding: BINDING,
        }),
      'ARTIFACT_MARKDOWN_IDENTITY_INVALID',
    );
    expectCode(
      () =>
        parseText(source, {
          identityMap: identityMap(first, {
            nodes: identityMap(first).nodes.map((node) => ({
              ...node,
              parentUnitId: 'nonexistent-parent',
            })),
          }),
          identityBinding: BINDING,
        }),
      'ARTIFACT_MARKDOWN_IDENTITY_INVALID',
    );
    expectCode(
      () =>
        parseText(source, {
          identityMap: identityMap(first, {
            nodes: identityMap(first).nodes.map((node) => ({ ...node, ordinal: 999 })),
          }),
          identityBinding: BINDING,
        }),
      'ARTIFACT_MARKDOWN_IDENTITY_INVALID',
    );
  });

  it('rejects an incomplete, extended or relocated sidecar correspondence', () => {
    const first = parseText(source);
    const map = identityMap(first);
    expectCode(
      () =>
        parseText(source, {
          identityMap: { ...map, nodes: map.nodes.slice(0, -1) },
          identityBinding: BINDING,
        }),
      'ARTIFACT_MARKDOWN_IDENTITY_INVALID',
    );
    expectCode(
      () =>
        parseText(source, {
          identityMap: {
            ...map,
            nodes: map.nodes.map((node, index) =>
              index === 1 ? { ...node, sourceNodePath: 'nonexistent/path' } : node,
            ),
          },
          identityBinding: BINDING,
        }),
      'ARTIFACT_MARKDOWN_IDENTITY_INVALID',
    );
    expectCode(
      () =>
        parseText(source, {
          identityMap: {
            ...map,
            columns: [{ tableUnitId: 'nonexistent-table', columnId: 'c0', ordinal: 0 }],
          },
          identityBinding: BINDING,
        }),
      'ARTIFACT_MARKDOWN_IDENTITY_INVALID',
    );
    expectCode(
      () =>
        parseText(source, {
          identityMap: {
            ...map,
            columns: [
              ...map.columns,
              { tableUnitId: map.columns[0]?.tableUnitId ?? 't', columnId: 'extra', ordinal: 9 },
            ],
          },
          identityBinding: BINDING,
        }),
      'ARTIFACT_MARKDOWN_IDENTITY_INVALID',
    );
  });

  it('rejects a sidecar bound to another document or profile', () => {
    const first = parseText(source);
    const map = identityMap(first);
    expectCode(
      () =>
        parseText(source, {
          documentId: '0199b600-0000-7000-8000-00000000d999',
          identityMap: map,
          identityBinding: BINDING,
        }),
      'ARTIFACT_MARKDOWN_IDENTITY_INVALID',
    );
    expectCode(
      () =>
        parseText(source, {
          enterpriseId: '0199b600-0000-7000-8000-00000000e999',
          identityMap: map,
          identityBinding: BINDING,
        }),
      'ARTIFACT_MARKDOWN_IDENTITY_INVALID',
    );
  });
});

describe('list line breaks and block boundaries', () => {
  it('keeps the marker line hard break instead of joining with a space', () => {
    const parsed = parseText('- first  \n  second\n');
    const item = defined(
      parsed.content.body.units.find((unit) => markdownMetadata(unit).blockKind === 'LIST_ITEM'),
      'list item',
    );
    expect(unitText(item)).toBe('first\nsecond');
    const spans = markdownMetadata(item).inlineSpans as readonly Artifact.MarkdownInlineSpan[];
    expect(spans.map((span) => span.kind)).toEqual(['HARD_BREAK']);
  });

  it('ends the list at a following heading instead of consuming it', () => {
    const parsed = parseText('- item\n# Heading\nbody\n');
    const items = parsed.content.body.units.filter(
      (unit) => markdownMetadata(unit).blockKind === 'LIST_ITEM',
    );
    expect(items).toHaveLength(1);
    expect(unitText(defined(items[0], 'list item'))).toBe('item');
    const sections = parsed.content.body.units.filter((unit) => unit.unitType === 'SECTION');
    expect(sections.map((unit) => unitText(unit))).toEqual(['Heading']);
    expect(sections[0]?.parentUnitId).toBeUndefined();
    expect(parsed.content.body.units.some((unit) => unitText(unit) === 'body')).toBe(true);
  });

  it('ends the list at a thematic break instead of consuming it', () => {
    const parsed = parseText('- item\n\n---\n');
    const breaks = parsed.content.body.units.filter(
      (unit) => markdownMetadata(unit).blockKind === 'THEMATIC_BREAK',
    );
    expect(breaks).toHaveLength(1);
  });
});

describe('unsupported extensions', () => {
  it('rejects an unescaped strikethrough extension', () => {
    expectCode(() => parseText('~~removed~~\n'), 'ARTIFACT_MARKDOWN_UNSUPPORTED');
  });

  it('keeps escaped tildes as literal text', () => {
    const parsed = parseText('\\~\\~removed\\~\\~\n');
    const paragraph = defined(
      parsed.content.body.units.find((unit) => unit.unitType === 'PARAGRAPH'),
      'paragraph',
    );
    expect(unitText(paragraph)).toBe('~~removed~~');
    expect(markdownMetadata(paragraph).inlineSpans).toEqual([]);
  });

  it('rejects an unescaped task-list extension and keeps its escaped literal', () => {
    expectCode(() => parseText('- [ ] task\n'), 'ARTIFACT_MARKDOWN_UNSUPPORTED');
    expectCode(() => parseText('- [x] task\n'), 'ARTIFACT_MARKDOWN_UNSUPPORTED');
    const parsed = parseText('- \\[ ] literal\n');
    const item = defined(
      parsed.content.body.units.find((unit) => markdownMetadata(unit).blockKind === 'LIST_ITEM'),
      'list item',
    );
    expect(unitText(item)).toBe('[ ] literal');
  });
});

describe('dangerous syntax outside code spans', () => {
  it('keeps link, footnote and script looking text literal inside inline code', () => {
    const parsed = parseText(
      '`[label](https://example.com)` and `[^note]` and `javascript:alert(1)`\n',
    );
    const paragraph = defined(
      parsed.content.body.units.find((unit) => unit.unitType === 'PARAGRAPH'),
      'paragraph',
    );
    expect(unitText(paragraph)).toBe(
      '[label](https://example.com) and [^note] and javascript:alert(1)',
    );
    expect(
      (markdownMetadata(paragraph).inlineSpans as readonly Artifact.MarkdownInlineSpan[]).map(
        (span) => span.kind,
      ),
    ).toEqual(['CODE', 'CODE', 'CODE']);
  });

  it('still rejects the same syntax outside code spans', () => {
    expectCode(() => parseText('[label](https://example.com)\n'), 'ARTIFACT_MARKDOWN_UNSAFE');
    expectCode(
      () => parseText('![image](https://example.com/p.png)\n'),
      'ARTIFACT_MARKDOWN_UNSAFE',
    );
    expectCode(() => parseText('see [^note]\n'), 'ARTIFACT_MARKDOWN_UNSUPPORTED');
    expectCode(() => parseText('javascript:alert(1)\n'), 'ARTIFACT_MARKDOWN_UNSAFE');
  });
});
