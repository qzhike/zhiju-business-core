import {
  PREVIEW_LIMITS as limits,
  PreviewFailure,
  previewLimit,
  type PreviewReason,
} from './profile.js';
import type { PreviewCell, PreviewSections } from './types.js';

export function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new PreviewFailure('INVALID_READER_OUTPUT');
  return value as Record<string, unknown>;
}
export function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > limits.nodes)
    throw new PreviewFailure('INVALID_READER_OUTPUT');
  return value as unknown[];
}
export function text(value: unknown): string {
  if (typeof value !== 'string') throw new PreviewFailure('INVALID_READER_OUTPUT');
  return value;
}
function integer(value: unknown, minimum = 1, maximum: number = limits.nodes): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new PreviewFailure('INVALID_READER_OUTPUT');
  return value;
}
function optionalText(value: unknown): string | undefined {
  return value === null ? undefined : text(value);
}

interface Content {
  readonly sections: PreviewSections;
  readonly limitations: readonly PreviewReason[];
}

/** Validate and reduce fixed extraction data; no arbitrary dictionaries cross the API. */
export function normalizeExtraction(value: unknown, source?: string): Content {
  const raw = record(value, [
    'format',
    'paragraphs',
    'numberingDefinitions',
    'styleDefinitions',
    'tables',
    'headersFooters',
    'comments',
    'commentMetadata',
    'revisions',
    'fields',
    'hyperlinks',
    'media',
    'embeddedObjects',
    'limitations',
    'technicalReadCeiling',
  ]);
  if (!['READ', 'PARTIAL'].includes(text(raw.technicalReadCeiling)))
    throw new PreviewFailure('INVALID_READER_OUTPUT');
  const readerLimits = list(raw.limitations).map(text);
  if (raw.format === 'MARKDOWN' && source !== undefined) {
    if (!source.trim()) throw new PreviewFailure('EMPTY_CONTENT');
    return {
      sections: { format: 'MARKDOWN', source },
      limitations: readerLimits.length ? ['INCOMPLETE_EXTRACTION'] : [],
    };
  }
  if (raw.format !== 'DOCX' || source !== undefined)
    throw new PreviewFailure('INVALID_READER_OUTPUT');
  const paragraphs = list(raw.paragraphs).map((value, index) => {
    const row = record(value, ['paragraph', 'text', 'style', 'numbering']);
    if (integer(row.paragraph) !== index + 1) throw new PreviewFailure('INVALID_READER_OUTPUT');
    const style = optionalText(row.style);
    return { position: index + 1, text: text(row.text), ...(style === undefined ? {} : { style }) };
  });
  const tables = list(raw.tables).map((value, tableIndex) => {
    const table = record(value, ['table', 'rows']);
    if (integer(table.table) !== tableIndex + 1) throw new PreviewFailure('INVALID_READER_OUTPUT');
    let previous = new Map<number, { cell: PreviewCell & { rowSpan: number }; span: number }>();
    const rows = list(table.rows).map((value, rowIndex) => {
      const row = record(value, ['row', 'cells']);
      if (integer(row.row) !== rowIndex + 1) throw new PreviewFailure('INVALID_READER_OUTPUT');
      let column = 1;
      const cells: PreviewCell[] = [];
      const next = new Map<number, { cell: PreviewCell & { rowSpan: number }; span: number }>();
      list(row.cells).forEach((value, cellIndex) => {
        const rawCell = record(value, ['column', 'text', 'gridSpan', 'verticalMerge']);
        if (integer(rawCell.column) !== cellIndex + 1)
          throw new PreviewFailure('INVALID_READER_OUTPUT');
        const colSpan = integer(rawCell.gridSpan, 1, 512);
        const content = text(rawCell.text);
        const merge = rawCell.verticalMerge;
        previewLimit(column + colSpan - 1, 512);
        if (merge !== null && merge !== 'restart' && merge !== 'continue')
          throw new PreviewFailure('INVALID_READER_OUTPUT');
        if (merge === 'continue') {
          const anchor = previous.get(column);
          if (anchor?.span !== colSpan || content.trim().length !== 0)
            throw new PreviewFailure('INVALID_READER_OUTPUT');
          anchor.cell.rowSpan++;
          next.set(column, anchor);
        } else {
          const cell = { text: content, column, colSpan, rowSpan: 1 };
          cells.push(cell);
          if (merge === 'restart') next.set(column, { cell, span: colSpan });
        }
        column += colSpan;
      });
      previous = next;
      return { cells };
    });
    return { position: tableIndex + 1, rows };
  });
  const headersFooters = list(raw.headersFooters).map((value) => {
    const row = record(value, ['part', 'text']);
    const part = text(row.part);
    if (!/^word\/(header|footer)[^/]*\.xml$/u.test(part))
      throw new PreviewFailure('INVALID_READER_OUTPUT');
    return { part, text: text(row.text) };
  });
  const comments = list(raw.comments).map((value) => {
    const row = record(value, ['id', 'text', 'paragraphs', 'author', 'date']);
    return {
      id: text(row.id),
      text: text(row.text),
      paragraphs: list(row.paragraphs).map((id) => integer(id, 1, paragraphs.length)),
    };
  });
  const revisions = list(raw.revisions).map((value) => {
    const row = record(value, ['kind', 'id', 'text']);
    if (
      row.kind !== 'ins' &&
      row.kind !== 'del' &&
      row.kind !== 'moveFrom' &&
      row.kind !== 'moveTo'
    )
      throw new PreviewFailure('INVALID_READER_OUTPUT');
    return { kind: row.kind, id: optionalText(row.id) ?? '', text: text(row.text) } as const;
  });
  const fields = list(raw.fields).map((value) => {
    const row = record(value, ['part', 'instruction']);
    const part = text(row.part);
    if (part !== 'word/document.xml' && !headersFooters.some((item) => item.part === part))
      throw new PreviewFailure('INVALID_READER_OUTPUT');
    return { part, text: text(row.instruction) };
  });
  if (![...paragraphs, ...headersFooters, ...comments, ...revisions].some((row) => row.text.trim()))
    throw new PreviewFailure('EMPTY_CONTENT');
  const limitations: PreviewReason[] = [
    'EXTRACTED_VIEW_ONLY',
    'TABLE_TEXT_REPEATED',
    'NUMBERING_NOT_RENDERED',
    'TEXT_REVISIONS_ONLY',
  ];
  if (list(raw.media).length > 0) limitations.push('MEDIA_NOT_INTERPRETED');
  if (list(raw.embeddedObjects).length > 0) throw new PreviewFailure('UNSAFE_CONTENT');
  if (readerLimits.length > 0 || list(raw.commentMetadata).length > 0)
    limitations.push('INCOMPLETE_EXTRACTION');
  return {
    sections: { format: 'DOCX', paragraphs, tables, headersFooters, comments, revisions, fields },
    limitations,
  };
}
