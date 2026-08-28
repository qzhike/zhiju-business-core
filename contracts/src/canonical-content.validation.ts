import type { ErrorObject } from 'ajv';

import { canonicalize, type CanonicalJsonValue } from '@zhiju/shared-kernel';

const schemaPath =
  'https://schemas.zhiju.local/modules/artifact/1.0#/$defs/canonicalContentPayload';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapePointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function invariantError(instancePath: string, reason: string): ErrorObject {
  return {
    instancePath,
    schemaPath,
    keyword: 'canonicalContentInvariant',
    params: { reason },
    message: reason,
  };
}

function assertUniqueIds(
  items: readonly unknown[],
  field: string,
  basePath: string,
  errors: ErrorObject[],
): Map<string, number> {
  const firstById = new Map<string, number>();
  for (const [index, item] of items.entries()) {
    if (!isRecord(item) || typeof item[field] !== 'string') continue;
    const id = item[field];
    const firstIndex = firstById.get(id);
    if (firstIndex !== undefined) {
      errors.push(
        invariantError(
          `${basePath}/${index}/${escapePointerSegment(field)}`,
          `duplicate ${field} '${id}' (first seen at index ${firstIndex})`,
        ),
      );
    } else {
      firstById.set(id, index);
    }
  }
  return firstById;
}

function validateDocument(body: UnknownRecord): ErrorObject[] {
  const errors: ErrorObject[] = [];
  const units = body.units;
  if (!Array.isArray(units)) return errors;

  const unitsById = assertUniqueIds(units, 'unitId', '/body/units', errors);
  const unitById = new Map<string, UnknownRecord>();
  const unitIndexById = new Map<string, number>();
  for (const [index, item] of units.entries()) {
    if (!isRecord(item) || typeof item.unitId !== 'string' || unitById.has(item.unitId)) continue;
    unitById.set(item.unitId, item);
    unitIndexById.set(item.unitId, index);
  }

  const siblingOrdinals = new Map<string, Map<number, number>>();
  for (const [index, item] of units.entries()) {
    if (!isRecord(item) || typeof item.unitId !== 'string') continue;
    const parentKey = typeof item.parentUnitId === 'string' ? item.parentUnitId : '<root>';
    const ordinal = item.ordinal;
    if (typeof ordinal === 'number') {
      const ordinals = siblingOrdinals.get(parentKey) ?? new Map<number, number>();
      const firstIndex = ordinals.get(ordinal);
      if (firstIndex !== undefined) {
        errors.push(
          invariantError(
            `/body/units/${index}/ordinal`,
            `duplicate ordinal ${ordinal} under parent '${parentKey}' (first seen at index ${firstIndex})`,
          ),
        );
      } else {
        ordinals.set(ordinal, index);
      }
      siblingOrdinals.set(parentKey, ordinals);
    }

    if (typeof item.parentUnitId === 'string') {
      const parent = unitById.get(item.parentUnitId);
      if (parent === undefined) {
        errors.push(
          invariantError(
            `/body/units/${index}/parentUnitId`,
            `parentUnitId '${item.parentUnitId}' does not reference a unit in this document`,
          ),
        );
      } else if (
        !Array.isArray(parent.childUnitIds) ||
        !parent.childUnitIds.includes(item.unitId)
      ) {
        errors.push(
          invariantError(
            `/body/units/${index}/parentUnitId`,
            `parent '${item.parentUnitId}' does not list '${item.unitId}' in childUnitIds`,
          ),
        );
      }
    }

    if (Array.isArray(item.childUnitIds)) {
      for (const [childIndex, childId] of item.childUnitIds.entries()) {
        if (typeof childId !== 'string') continue;
        const child = unitById.get(childId);
        if (child === undefined) {
          errors.push(
            invariantError(
              `/body/units/${index}/childUnitIds/${childIndex}`,
              `childUnitId '${childId}' does not reference a unit in this document`,
            ),
          );
        } else if (child.parentUnitId !== item.unitId) {
          errors.push(
            invariantError(
              `/body/units/${index}/childUnitIds/${childIndex}`,
              `child '${childId}' does not point back to parent '${item.unitId}'`,
            ),
          );
        }
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (unitId: string): void => {
    if (visited.has(unitId)) return;
    if (visiting.has(unitId)) {
      const index = unitIndexById.get(unitId);
      errors.push(
        invariantError(
          index === undefined ? '/body/units' : `/body/units/${index}/parentUnitId`,
          `parentUnitId cycle includes '${unitId}'`,
        ),
      );
      return;
    }
    const unit = unitById.get(unitId);
    if (unit === undefined) return;
    visiting.add(unitId);
    if (typeof unit.parentUnitId === 'string' && unitsById.has(unit.parentUnitId)) {
      visit(unit.parentUnitId);
    }
    visiting.delete(unitId);
    visited.add(unitId);
  };
  for (const unitId of unitById.keys()) visit(unitId);

  return errors;
}

function isWellFormedFormula(formula: string): boolean {
  if (!formula.startsWith('=')) return false;
  let parentheses = 0;
  let inString = false;
  for (const character of formula.slice(1)) {
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === '(') parentheses += 1;
    if (character === ')') {
      parentheses -= 1;
      if (parentheses < 0) return false;
    }
  }
  return parentheses === 0 && !inString;
}

function validateWorkbook(body: UnknownRecord): ErrorObject[] {
  const errors: ErrorObject[] = [];
  const sheets = body.sheets;
  if (!Array.isArray(sheets)) return errors;

  assertUniqueIds(sheets, 'sheetId', '/body/sheets', errors);
  for (const [sheetIndex, sheetValue] of sheets.entries()) {
    if (!isRecord(sheetValue)) continue;
    const columns = Array.isArray(sheetValue.columns) ? sheetValue.columns : [];
    const rows = Array.isArray(sheetValue.rows) ? sheetValue.rows : [];
    const columnById = assertUniqueIds(
      columns,
      'columnId',
      `/body/sheets/${sheetIndex}/columns`,
      errors,
    );
    assertUniqueIds(rows, 'rowId', `/body/sheets/${sheetIndex}/rows`, errors);

    for (const [rowIndex, rowValue] of rows.entries()) {
      if (!isRecord(rowValue) || !Array.isArray(rowValue.cells)) continue;
      assertUniqueIds(
        rowValue.cells,
        'cellId',
        `/body/sheets/${sheetIndex}/rows/${rowIndex}/cells`,
        errors,
      );
      for (const [cellIndex, cellValue] of rowValue.cells.entries()) {
        if (!isRecord(cellValue)) continue;
        if (typeof cellValue.columnId === 'string' && !columnById.has(cellValue.columnId)) {
          errors.push(
            invariantError(
              `/body/sheets/${sheetIndex}/rows/${rowIndex}/cells/${cellIndex}/columnId`,
              `columnId '${cellValue.columnId}' does not reference a Column in this Sheet`,
            ),
          );
        }
        if (typeof cellValue.formula === 'string' && !isWellFormedFormula(cellValue.formula)) {
          errors.push(
            invariantError(
              `/body/sheets/${sheetIndex}/rows/${rowIndex}/cells/${cellIndex}/formula`,
              'formula must start with = and have balanced parentheses and quoted strings',
            ),
          );
        }
      }
    }
  }
  return errors;
}

export function canonicalContentInvariantErrors(input: unknown): readonly ErrorObject[] {
  if (!isRecord(input) || !isRecord(input.body)) return [];
  const errors =
    input.contentType === 'STRUCTURED_DOCUMENT'
      ? validateDocument(input.body)
      : input.contentType === 'WORKBOOK_SPEC'
        ? validateWorkbook(input.body)
        : [];
  try {
    canonicalize(input as unknown as CanonicalJsonValue);
  } catch (error) {
    errors.push(
      invariantError(
        '',
        error instanceof Error ? error.message : 'Canonical JSON normalization failed',
      ),
    );
  }
  return errors;
}
