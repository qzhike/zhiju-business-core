// #270 closed Markdown document profile invariants: the JSON Schema closes each
// unit's metadata shape, this module closes the cross-unit graph and the inline
// span rules that a per-node schema cannot express.

import type { ErrorObject } from 'ajv';

import { canonicalDocumentInvariantErrors, isRecord } from './canonical-content.validation.js';

type UnknownRecord = Record<string, unknown>;

/** Static membership tables for the closed Markdown unit and span vocabulary. */
export const markdownUnitKinds: Readonly<Record<string, true>> = {
  SECTION: true,
  PARAGRAPH: true,
  TABLE: true,
  TABLE_ROW: true,
  TABLE_CELL: true,
};
const markdownSpanKinds: Readonly<Record<string, true>> = {
  STRONG: true,
  EMPHASIS: true,
  CODE: true,
  HARD_BREAK: true,
};

function invariantError(instancePath: string, reason: string): ErrorObject {
  return {
    instancePath,
    schemaPath: '#/$defs/markdownDocumentInvariants',
    keyword: 'markdownDocumentInvariants',
    params: {},
    message: reason,
  };
}

function markdownMetadata(unit: UnknownRecord): UnknownRecord | undefined {
  const semantic = unit.semanticMetadata;
  if (!isRecord(semantic)) return undefined;
  const markdown = semantic.markdown;
  return isRecord(markdown) ? markdown : undefined;
}

function isSpan(span: UnknownRecord): boolean {
  return (
    Number.isInteger(span.start) && Number.isInteger(span.end) && typeof span.kind === 'string'
  );
}

function validateInlineSpans(
  text: string | undefined,
  metadata: UnknownRecord,
  basePath: string,
  errors: ErrorObject[],
): void {
  const rawSpans = metadata.inlineSpans;
  const spans = Array.isArray(rawSpans) ? rawSpans.filter(isRecord).filter(isSpan) : [];
  const points = text === undefined ? undefined : Array.from(text);
  let previousStart = -1;
  let previousEnd = -1;
  let previousKind = '';

  for (const [index, span] of spans.entries()) {
    const start = span.start as number;
    const end = span.end as number;
    const kind = span.kind as string;
    const spanPath = `${basePath}/inlineSpans/${index}`;
    if (markdownSpanKinds[kind] === undefined) {
      errors.push(invariantError(`${spanPath}/kind`, `unsupported inline span kind '${kind}'`));
      continue;
    }
    if (start < 0 || end <= start) {
      errors.push(
        invariantError(spanPath, `inline span interval [${start}, ${end}) is not a valid range`),
      );
      continue;
    }
    if (points !== undefined && end > points.length) {
      errors.push(
        invariantError(spanPath, `inline span end ${end} exceeds the text length ${points.length}`),
      );
      continue;
    }
    const combinesEmphasis =
      start === previousStart &&
      end === previousEnd &&
      kind !== previousKind &&
      kind !== 'CODE' &&
      kind !== 'HARD_BREAK' &&
      previousKind !== 'CODE' &&
      previousKind !== 'HARD_BREAK';
    if (start < previousEnd && !combinesEmphasis) {
      errors.push(
        invariantError(
          spanPath,
          'inline span overlaps the previous span; spans must be ordered and non-nested',
        ),
      );
      continue;
    }
    if (!combinesEmphasis) {
      previousStart = start;
      previousEnd = end;
      previousKind = kind;
    }
    if (kind === 'HARD_BREAK' && (end - start !== 1 || points?.[start] !== '\n')) {
      errors.push(
        invariantError(spanPath, 'HARD_BREAK must cover exactly one LF code point of the text'),
      );
    }
  }
}

function validateTable(
  unit: UnknownRecord,
  unitById: Map<string, UnknownRecord>,
  unitIndexById: Map<string, number>,
  errors: ErrorObject[],
): void {
  const metadata = markdownMetadata(unit);
  const index = unitIndexById.get(unit.unitId as string) ?? 0;
  const basePath = `/body/units/${index}/semanticMetadata/markdown`;
  if (metadata === undefined) return;

  const columns = Array.isArray(metadata.columns) ? metadata.columns.filter(isRecord) : [];
  const columnIds = new Set<string>();
  const columnOrdinals = new Set<number>();
  for (const [columnIndex, column] of columns.entries()) {
    if (typeof column.columnId === 'string') {
      if (columnIds.has(column.columnId)) {
        errors.push(
          invariantError(
            `${basePath}/columns/${columnIndex}/columnId`,
            `duplicate columnId '${column.columnId}'`,
          ),
        );
      }
      columnIds.add(column.columnId);
    }
    if (Number.isInteger(column.ordinal)) {
      if (columnOrdinals.has(column.ordinal as number)) {
        errors.push(
          invariantError(
            `${basePath}/columns/${columnIndex}/ordinal`,
            `duplicate column ordinal ${String(column.ordinal)}`,
          ),
        );
      }
      columnOrdinals.add(column.ordinal as number);
    }
    if (column.ordinal !== columnIndex) {
      errors.push(
        invariantError(
          `${basePath}/columns/${columnIndex}/ordinal`,
          `column ordinal ${String(column.ordinal)} must equal its position ${columnIndex}`,
        ),
      );
    }
  }

  if (typeof metadata.headerRowUnitId === 'string') {
    const header = unitById.get(metadata.headerRowUnitId);
    if (header === undefined || header.parentUnitId !== unit.unitId) {
      errors.push(
        invariantError(
          `${basePath}/headerRowUnitId`,
          `headerRowUnitId '${metadata.headerRowUnitId}' must reference a row of this table`,
        ),
      );
    } else if (markdownMetadata(header)?.rowRole !== 'HEADER') {
      errors.push(
        invariantError(
          `${basePath}/headerRowUnitId`,
          `headerRowUnitId '${metadata.headerRowUnitId}' must reference a HEADER row`,
        ),
      );
    }
  }
  if (typeof metadata.captionUnitId === 'string') {
    const caption = unitById.get(metadata.captionUnitId);
    if (caption?.unitType !== 'PARAGRAPH') {
      errors.push(
        invariantError(
          `${basePath}/captionUnitId`,
          `captionUnitId '${metadata.captionUnitId}' must reference a PARAGRAPH`,
        ),
      );
    }
  }

  const children = Array.isArray(unit.childUnitIds) ? unit.childUnitIds : [];
  let headerCount = 0;
  for (const [rowIndex, childId] of children.entries()) {
    const row = typeof childId === 'string' ? unitById.get(childId) : undefined;
    if (row === undefined) continue;
    const rowPath = `/body/units/${unitIndexById.get(row.unitId as string) ?? 0}`;
    if (row.unitType !== 'TABLE_ROW') {
      errors.push(
        invariantError(`${basePath}/childUnitIds/${rowIndex}`, 'table child must be a TABLE_ROW'),
      );
      continue;
    }
    if (markdownMetadata(row)?.rowRole === 'HEADER') {
      headerCount += 1;
      if (headerCount > 1) {
        errors.push(invariantError(rowPath, 'a table may declare exactly one HEADER row'));
      }
    }
    const cells = Array.isArray(row.childUnitIds) ? row.childUnitIds : [];
    if (cells.length !== columns.length) {
      errors.push(
        invariantError(
          `${rowPath}/childUnitIds`,
          `row has ${cells.length} cells for ${columns.length} columns`,
        ),
      );
      continue;
    }
    for (const [cellIndex, cellId] of cells.entries()) {
      const cell = typeof cellId === 'string' ? unitById.get(cellId) : undefined;
      if (cell === undefined) continue;
      if (cell.unitType !== 'TABLE_CELL') {
        errors.push(
          invariantError(`${rowPath}/childUnitIds/${cellIndex}`, 'row child must be a TABLE_CELL'),
        );
        continue;
      }
      const cellPath = `/body/units/${unitIndexById.get(cell.unitId as string) ?? 0}`;
      if (
        markdownMetadata(cell)?.columnId !==
        (columns[cellIndex] as UnknownRecord | undefined)?.columnId
      ) {
        errors.push(
          invariantError(
            `${cellPath}/semanticMetadata/markdown/columnId`,
            `cell columnId '${String(markdownMetadata(cell)?.columnId)}' must match column ${cellIndex}`,
          ),
        );
      }
    }
  }
}

/** Cross-unit invariants of one closed Markdown document body. */
export function markdownDocumentBodyInvariantErrors(body: UnknownRecord): readonly ErrorObject[] {
  const errors: ErrorObject[] = [...canonicalDocumentInvariantErrors(body)];
  const units = body.units;
  if (!Array.isArray(units)) return errors;

  const unitById = new Map<string, UnknownRecord>();
  const unitIndexById = new Map<string, number>();
  for (const [index, unit] of units.entries()) {
    if (!isRecord(unit) || typeof unit.unitId !== 'string' || unitById.has(unit.unitId)) continue;
    unitById.set(unit.unitId, unit);
    unitIndexById.set(unit.unitId, index);
  }

  for (const [index, unit] of units.entries()) {
    if (!isRecord(unit) || typeof unit.unitId !== 'string') continue;
    const unitPath = `/body/units/${index}`;
    const metadata = markdownMetadata(unit);
    if (metadata === undefined) {
      errors.push(
        invariantError(
          `${unitPath}/semanticMetadata`,
          'the markdown profile requires exactly one markdown metadata object',
        ),
      );
      continue;
    }

    if (unit.unitType === 'TABLE') {
      validateTable(unit, unitById, unitIndexById, errors);
    } else if (unit.unitType === 'TABLE_ROW') {
      const parentUnitId = unit.parentUnitId;
      const parent = typeof parentUnitId === 'string' ? unitById.get(parentUnitId) : undefined;
      if (parent?.unitType !== 'TABLE') {
        errors.push(
          invariantError(`${unitPath}/parentUnitId`, 'TABLE_ROW must be a child of a TABLE'),
        );
      }
    } else if (unit.unitType === 'TABLE_CELL') {
      const parentUnitId = unit.parentUnitId;
      const parent = typeof parentUnitId === 'string' ? unitById.get(parentUnitId) : undefined;
      if (parent?.unitType !== 'TABLE_ROW') {
        errors.push(
          invariantError(`${unitPath}/parentUnitId`, 'TABLE_CELL must be a child of a TABLE_ROW'),
        );
      }
    } else if (unit.unitType === 'SECTION' && typeof unit.parentUnitId === 'string') {
      const parent = unitById.get(unit.parentUnitId);
      const parentLevel = parent === undefined ? undefined : markdownMetadata(parent)?.headingLevel;
      const level = metadata.headingLevel;
      if (
        parent?.unitType === 'SECTION' &&
        typeof parentLevel === 'number' &&
        typeof level === 'number' &&
        level <= parentLevel
      ) {
        errors.push(
          invariantError(
            `${unitPath}/semanticMetadata/markdown/headingLevel`,
            `heading level ${level} must be greater than its parent heading level ${parentLevel}`,
          ),
        );
      }
    }

    validateInlineSpans(
      typeof unit.text === 'string' ? unit.text : undefined,
      metadata,
      `${unitPath}/semanticMetadata/markdown`,
      errors,
    );
  }

  return errors;
}

/** Invariants of the closed Markdown identity sidecar. */
export function markdownIdentityMapInvariantErrors(input: unknown): readonly ErrorObject[] {
  const errors: ErrorObject[] = [];
  if (!isRecord(input)) return errors;
  const nodes = Array.isArray(input.nodes) ? input.nodes.filter(isRecord) : [];
  const columns = Array.isArray(input.columns) ? input.columns.filter(isRecord) : [];

  const byUnitId = new Map<string, number>();
  const byPath = new Map<string, number>();
  for (const [index, node] of nodes.entries()) {
    if (typeof node.unitId === 'string') {
      const first = byUnitId.get(node.unitId);
      if (first !== undefined) {
        errors.push(
          invariantError(
            `/nodes/${index}/unitId`,
            `duplicate unitId '${node.unitId}' (first seen at index ${first})`,
          ),
        );
      } else {
        byUnitId.set(node.unitId, index);
      }
    }
    if (typeof node.sourceNodePath === 'string') {
      const first = byPath.get(node.sourceNodePath);
      if (first !== undefined) {
        errors.push(
          invariantError(
            `/nodes/${index}/sourceNodePath`,
            `duplicate sourceNodePath '${node.sourceNodePath}' (first seen at index ${first})`,
          ),
        );
      } else {
        byPath.set(node.sourceNodePath, index);
      }
    }
    if (typeof node.type === 'string' && markdownUnitKinds[node.type] === undefined) {
      errors.push(invariantError(`/nodes/${index}/type`, `unsupported unit type '${node.type}'`));
    }
  }

  const byColumnKey = new Set<string>();
  for (const [index, column] of columns.entries()) {
    if (typeof column.tableUnitId !== 'string' || typeof column.columnId !== 'string') continue;
    const key = `${column.tableUnitId}\u0000${column.columnId}`;
    if (byColumnKey.has(key)) {
      errors.push(
        invariantError(
          `/columns/${index}/columnId`,
          `duplicate column '${column.columnId}' for table '${column.tableUnitId}'`,
        ),
      );
    } else {
      byColumnKey.add(key);
    }
  }

  return errors;
}

/** Closed Markdown document content payload + cross-unit invariants. */
export function markdownContentInvariantErrors(input: unknown): readonly ErrorObject[] {
  if (!isRecord(input) || !isRecord(input.body)) return [];
  return markdownDocumentBodyInvariantErrors(input.body);
}
