// #270: deterministic Markdown renderer for the closed
// `artifact.markdown_document@1.0` canonical profile. IntegrationGateway owns
// rendering only; canonical parsing, identity and round-trip validation are
// Artifact-owned. The renderer fixes LF line endings, escaping, list markers and
// table padding so that `parse(render(tree), authoritativeIdentityMap) = tree`.

import { createHash } from 'node:crypto';

import { getContractRegistry, type Artifact, type Common } from '@zhiju/contracts';

const registry = getContractRegistry();

export const MARKDOWN_RENDERER_PROFILE = Object.freeze({
  outputFormat: 'zhiju.markdown',
  rendererId: 'zhiju.renderer.markdown.canonical',
  rendererVersion: '1.0.0',
  mediaType: 'text/markdown; charset=utf-8',
  extension: 'md',
  contentType: 'STRUCTURED_DOCUMENT',
} as const);

export interface RenderedMarkdownObject {
  readonly bytes: Buffer;
  readonly checksum: Common.ContentHash;
  readonly mediaType: string;
  readonly extension: 'md';
  readonly rendererId: string;
  readonly rendererVersion: string;
}

export type MarkdownRendererErrorCode =
  'INTEGRATION_RENDER_INPUT_MISMATCH' | 'INTEGRATION_MARKDOWN_RENDER_INVALID';

export class MarkdownRendererInputError extends Error {
  constructor(
    readonly code: MarkdownRendererErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MarkdownRendererInputError';
  }
}

const ESCAPED_CHARACTERS = new Set(['\\', '`', '*', '|', '<', '>', '#', '=', '~']);
const THEMATIC_LINE = /^(?:\*[ \t]*){3,}$|^(?:-[ \t]*){3,}$|^(?:_[ \t]*){3,}$/u;
const ORDERED_LINE_START = /^(\d{1,9})([.)])[ \t]/u;
const SEPARATOR_BY_ALIGNMENT: Readonly<Record<string, string>> = {
  NONE: '---',
  LEFT: ':---',
  CENTER: ':---:',
  RIGHT: '---:',
};

interface MarkdownMetadataView {
  readonly blockKind?: string;
  readonly headingLevel?: number;
  readonly inlineSpans?: readonly Artifact.MarkdownInlineSpan[];
  readonly listId?: string;
  readonly listKind?: string;
  readonly listOrdinal?: number;
  readonly listDepth?: number;
  readonly orderedMarker?: string;
  readonly columns?: readonly Artifact.MarkdownTableColumn[];
  readonly headerRowUnitId?: string;
  readonly valueState?: string;
}

function fail(code: MarkdownRendererErrorCode, message: string): never {
  throw new MarkdownRendererInputError(code, message);
}

/** The registry validator has already proven this closed metadata shape. */
function markdownMetadataOf(unit: Artifact.MarkdownDocumentUnit): MarkdownMetadataView {
  return (unit.semanticMetadata as { markdown?: MarkdownMetadataView }).markdown ?? {};
}

/** Only TABLE/TABLE_ROW/THEMATIC_BREAK variants have no unit text. */
function unitText(unit: Artifact.MarkdownDocumentUnit): string {
  return 'text' in unit && typeof unit.text === 'string' ? unit.text : '';
}

function escapeLiteral(value: string): string {
  let out = '';
  for (const character of value) {
    out += ESCAPED_CHARACTERS.has(character) ? `\\${character}` : character;
  }
  return out;
}

function fenceFor(code: string): string {
  const longest = Math.max(0, ...[...code.matchAll(/`+/gu)].map((match) => match[0].length));
  const fence = '`'.repeat(longest + 1);
  const padded = code.startsWith('`') || code.endsWith('`') ? ` ${code} ` : code;
  return `${fence}${padded}${fence}`;
}

/** Renders one logical text (unit text or table cell) with its closed inline spans. */
export function renderMarkdownInline(
  text: string,
  spans: readonly Artifact.MarkdownInlineSpan[],
): string {
  if (text.startsWith(' ') || text.startsWith('\t')) {
    fail(
      'INTEGRATION_MARKDOWN_RENDER_INVALID',
      'leading whitespace cannot be represented in canonical Markdown',
    );
  }
  const points = Array.from(text);
  const spanByStart = new Map<number, Artifact.MarkdownInlineSpan[]>();
  for (const span of [...spans].sort((left, right) => left.start - right.start)) {
    const list = spanByStart.get(span.start) ?? [];
    list.push(span);
    spanByStart.set(span.start, list);
  }

  let out = '';
  let index = 0;
  while (index < points.length) {
    const starting = spanByStart.get(index);
    if (starting !== undefined && starting.length > 0) {
      const end = starting[0]?.end ?? index;
      const kinds = new Set(starting.map((span) => span.kind));
      const inner = points.slice(index, end).join('');
      if (kinds.has('HARD_BREAK')) {
        out += '<br>';
      } else if (kinds.has('CODE')) {
        out += fenceFor(inner);
      } else {
        const marker =
          kinds.has('STRONG') && kinds.has('EMPHASIS') ? '***' : kinds.has('STRONG') ? '**' : '*';
        out += `${marker}${escapeLiteral(inner)}${marker}`;
      }
      index = end;
      continue;
    }
    const character = points[index];
    if (character === undefined) break;
    out += ESCAPED_CHARACTERS.has(character) ? `\\${character}` : character;
    index += 1;
  }

  // A line that would read back as a thematic break, list item or ordered marker
  // must not delimit a new block; escape the character that would start it.
  if (THEMATIC_LINE.test(out) || /^[-+]/u.test(out)) return `\\${out}`;
  const orderedLine = ORDERED_LINE_START.exec(out);
  if (orderedLine !== null) {
    return `${orderedLine[1]}\\${orderedLine[2]}${out.slice((orderedLine[1] ?? '').length + 1)}`;
  }
  return out;
}

function renderTable(
  table: Artifact.MarkdownDocumentUnit,
  lookup: ReadonlyMap<string, Artifact.MarkdownDocumentUnit>,
): string {
  const metadata = markdownMetadataOf(table);
  const columns = metadata.columns ?? [];
  const rows = table.childUnitIds
    .map((id) => lookup.get(id))
    .filter((unit): unit is Artifact.MarkdownDocumentUnit => unit?.unitType === 'TABLE_ROW');
  const header = rows.find((row) => row.unitId === metadata.headerRowUnitId);
  if (header === undefined) {
    fail('INTEGRATION_MARKDOWN_RENDER_INVALID', 'table header row is not resolvable');
  }

  const renderRow = (row: Artifact.MarkdownDocumentUnit): string =>
    `| ${row.childUnitIds
      .map((id) => {
        const cell = lookup.get(id);
        if (cell === undefined) {
          return fail('INTEGRATION_MARKDOWN_RENDER_INVALID', 'table cell is not resolvable');
        }
        const cellMetadata = markdownMetadataOf(cell);
        if (cellMetadata.valueState === 'BLANK') return '';
        return renderMarkdownInline(unitText(cell), cellMetadata.inlineSpans ?? []);
      })
      .join(' | ')} |`;

  const lines = [
    renderRow(header),
    `| ${columns.map((column) => SEPARATOR_BY_ALIGNMENT[column.alignment]).join(' | ')} |`,
  ];
  for (const row of rows) {
    if (row.unitId === header.unitId) continue;
    lines.push(renderRow(row));
  }
  return lines.join('\n');
}

export function renderMarkdownDocument(
  content: Artifact.MarkdownDocumentContent,
): RenderedMarkdownObject {
  const validation = registry.validateMarkdownDocumentContent(content);
  if (!validation.valid) {
    fail(
      'INTEGRATION_RENDER_INPUT_MISMATCH',
      `canonical Markdown document is not valid: ${validation.errors[0]?.message ?? 'invalid'}`,
    );
  }

  const unitById = new Map<string, Artifact.MarkdownDocumentUnit>();
  for (const unit of content.body.units) unitById.set(unit.unitId, unit);

  const renderListRun = (items: readonly Artifact.MarkdownDocumentUnit[]): string => {
    const lines: string[] = [];
    const emitItem = (item: Artifact.MarkdownDocumentUnit): void => {
      const metadata = markdownMetadataOf(item);
      const depth = Math.max(1, metadata.listDepth ?? 1);
      const marker =
        metadata.listKind === 'ORDERED'
          ? (metadata.orderedMarker ?? `${String(metadata.listOrdinal ?? 1)}.`)
          : '-';
      lines.push(
        `${'  '.repeat(depth - 1)}${marker} ${renderMarkdownInline(unitText(item), metadata.inlineSpans ?? [])}`,
      );
      for (const childId of item.childUnitIds) {
        const child = unitById.get(childId);
        if (child !== undefined) emitItem(child);
      }
    };
    for (const item of items) emitItem(item);
    return lines.join('\n');
  };

  const blocks: string[] = [];
  const childrenByParent = new Map<string | undefined, Artifact.MarkdownDocumentUnit[]>();
  for (const unit of content.body.units) {
    const siblings = childrenByParent.get(unit.parentUnitId) ?? [];
    siblings.push(unit);
    childrenByParent.set(unit.parentUnitId, siblings);
  }

  const renderSiblings = (parentUnitId: string | undefined): void => {
    const units = childrenByParent.get(parentUnitId) ?? [];
    let index = 0;
    while (index < units.length) {
      const unit = units[index];
      if (unit === undefined) break;
      const metadata = markdownMetadataOf(unit);
      if (unit.unitType === 'PARAGRAPH' && metadata.blockKind === 'LIST_ITEM') {
        const run: Artifact.MarkdownDocumentUnit[] = [];
        while (index < units.length) {
          const candidate = units[index];
          if (candidate === undefined) break;
          const candidateMetadata = markdownMetadataOf(candidate);
          if (!(
            candidate.unitType === 'PARAGRAPH' &&
            candidateMetadata.blockKind === 'LIST_ITEM' &&
            candidateMetadata.listId === metadata.listId
          )) {
            break;
          }
          run.push(candidate);
          index += 1;
        }
        blocks.push(renderListRun(run));
        continue;
      }
      if (unit.unitType === 'SECTION') {
        blocks.push(
          `${'#'.repeat(metadata.headingLevel ?? 1)} ${renderMarkdownInline(unitText(unit), metadata.inlineSpans ?? [])}`,
        );
        renderSiblings(unit.unitId);
      } else if (unit.unitType === 'PARAGRAPH' && metadata.blockKind === 'THEMATIC_BREAK') {
        blocks.push('---');
      } else if (unit.unitType === 'PARAGRAPH') {
        blocks.push(renderMarkdownInline(unitText(unit), metadata.inlineSpans ?? []));
      } else if (unit.unitType === 'TABLE') {
        blocks.push(renderTable(unit, unitById));
      }
      index += 1;
    }
  };
  renderSiblings(undefined);

  const bytes = Buffer.from(`${blocks.join('\n\n')}\n`, 'utf8');
  return {
    bytes,
    checksum: {
      algorithm: 'SHA-256',
      digest: createHash('sha256').update(bytes).digest('hex'),
      canonicalizationVersion: '1',
    },
    mediaType: MARKDOWN_RENDERER_PROFILE.mediaType,
    extension: 'md',
    rendererId: MARKDOWN_RENDERER_PROFILE.rendererId,
    rendererVersion: MARKDOWN_RENDERER_PROFILE.rendererVersion,
  };
}
