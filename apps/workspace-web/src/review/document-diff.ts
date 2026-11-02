import type { Document, InlineSpan, Unit } from '../trusted/markdown.js';

export interface DocumentLine {
  number: number;
  text: string;
  unitIds: string[];
}

export interface DiffLine {
  kind: 'context' | 'removed' | 'added';
  before?: DocumentLine | undefined;
  after?: DocumentLine | undefined;
}

function inlineSource(text: string, spans: InlineSpan[] = []): string {
  const points = Array.from(text);
  let output = '';
  let offset = 0;
  while (offset < points.length) {
    const found = spans.filter((span) => span.start === offset);
    const end = found[0]?.end;
    if (end === undefined || end <= offset || end > points.length) {
      output += points[offset] ?? '';
      offset++;
      continue;
    }
    let value = points.slice(offset, end).join('');
    if (found.some((span) => span.kind === 'HARD_BREAK')) value = '\n';
    else {
      if (found.some((span) => span.kind === 'CODE')) value = `\`${value}\``;
      if (found.some((span) => span.kind === 'EMPHASIS')) value = `*${value}*`;
      if (found.some((span) => span.kind === 'STRONG')) value = `**${value}**`;
    }
    output += value;
    offset = end;
  }
  return output;
}

/** Reading coordinates in normalized content, never physical DOCX/source lines. */
export function documentLines(document: Document): DocumentLine[] {
  const units = new Map(document.units.map((unit) => [unit.unitId, unit]));
  const lines: DocumentLine[] = [];
  const append = (text: string, unitIds: string[]) => {
    for (const line of text.replace(/\r\n?/gu, '\n').split('\n')) {
      lines.push({ number: lines.length + 1, text: line, unitIds });
    }
  };
  const visit = (unit: Unit, ancestors: string[]) => {
    const ids = [unit.unitId, ...ancestors];
    const meta = unit.semanticMetadata.markdown;
    const children = unit.childUnitIds
      .map((id) => units.get(id))
      .filter((child): child is Unit => child !== undefined);
    const text = inlineSource(unit.text ?? '', meta.inlineSpans);
    if (unit.unitType === 'TABLE') {
      if (text) append(text, ids);
      children.forEach((row, index) => {
        const cells = row.childUnitIds
          .map((id) => units.get(id))
          .filter((cell): cell is Unit => cell !== undefined);
        const rowIds = [row.unitId, ...cells.map((cell) => cell.unitId), ...ids];
        append(
          `| ${cells.map((cell) => inlineSource(cell.text ?? '', cell.semanticMetadata.markdown.inlineSpans).replace(/\r?\n/gu, ' ↵ ')).join(' | ')} |`,
          rowIds,
        );
        if (index === 0) {
          append(
            `| ${cells
              .map((_, column) => {
                const alignment = meta.columns?.[column]?.alignment;
                return alignment === 'CENTER' ? ':---:' : alignment === 'RIGHT' ? '---:' : ':---';
              })
              .join(' | ')} |`,
            rowIds,
          );
        }
      });
      append('', ids);
      return;
    }
    if (unit.unitType === 'SECTION') {
      append(`${'#'.repeat(Math.min(6, Math.max(1, meta.headingLevel ?? 1)))} ${text}`, ids);
    } else if (meta.blockKind === 'THEMATIC_BREAK') append('---', ids);
    else if (meta.blockKind === 'LIST_ITEM') {
      const marker = meta.listKind === 'ORDERED' ? (meta.orderedMarker ?? '1.') : '-';
      append(`${'  '.repeat(Math.max(0, meta.listDepth ?? 0))}${marker} ${text}`, ids);
    } else append(text, ids);
    append('', ids);
    children.forEach((child) => {
      visit(child, ids);
    });
  };
  document.units
    .filter((unit) => unit.parentUnitId === undefined)
    .forEach((unit) => {
      visit(unit, []);
    });
  return lines;
}

/** Bounded LCS for visual alignment only; business change identities stay upstream. */
export function documentDiff(
  before: DocumentLine[],
  after: DocumentLine[],
): {
  lines: DiffLine[];
  coarse: boolean;
} {
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix]?.text === after[prefix]?.text
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix]?.text === after[after.length - 1 - suffix]?.text
  )
    suffix++;
  const left = before.slice(prefix, before.length - suffix);
  const right = after.slice(prefix, after.length - suffix);
  const lines: DiffLine[] = before
    .slice(0, prefix)
    .map((line, index) => ({ kind: 'context', before: line, after: after[index] }));
  const coarse = (left.length + 1) * (right.length + 1) > 1_000_000;
  if (coarse) {
    lines.push(
      ...left.map((line): DiffLine => ({ kind: 'removed', before: line })),
      ...right.map((line): DiffLine => ({ kind: 'added', after: line })),
    );
  } else {
    const stride = right.length + 1;
    const scores = new Uint32Array((left.length + 1) * stride);
    for (let i = left.length - 1; i >= 0; i--) {
      for (let j = right.length - 1; j >= 0; j--) {
        scores[i * stride + j] =
          left[i]?.text === right[j]?.text
            ? 1 + (scores[(i + 1) * stride + j + 1] ?? 0)
            : Math.max(scores[(i + 1) * stride + j] ?? 0, scores[i * stride + j + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i]?.text === right[j]?.text) {
        lines.push({ kind: 'context', before: left[i++], after: right[j++] });
      } else if (
        i < left.length &&
        (j === right.length ||
          (scores[(i + 1) * stride + j] ?? 0) >= (scores[i * stride + j + 1] ?? 0))
      ) {
        lines.push({ kind: 'removed', before: left[i++] });
      } else lines.push({ kind: 'added', after: right[j++] });
    }
  }
  for (let offset = suffix; offset > 0; offset--) {
    lines.push({
      kind: 'context',
      before: before[before.length - offset],
      after: after[after.length - offset],
    });
  }
  return { lines, coarse };
}

export function splitDiff(lines: DiffLine[]): DiffLine[] {
  const rows: DiffLine[] = [];
  let position = 0;
  while (position < lines.length) {
    const current = lines[position];
    if (!current) break;
    if (current.kind === 'context') {
      rows.push(current);
      position++;
      continue;
    }
    const removed: DocumentLine[] = [];
    const added: DocumentLine[] = [];
    while (position < lines.length && lines[position]?.kind !== 'context') {
      const line = lines[position++];
      if (line?.before) removed.push(line.before);
      if (line?.after) added.push(line.after);
    }
    for (let index = 0; index < Math.max(removed.length, added.length); index++) {
      rows.push({ kind: 'removed', before: removed[index], after: added[index] });
    }
  }
  return rows;
}
