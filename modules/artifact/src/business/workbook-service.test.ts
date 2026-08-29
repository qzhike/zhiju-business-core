import { describe, expect, it } from 'vitest';
import type { Artifact, Common } from '@zhiju/contracts';
import {
  canonicalizeWorkbookSpec,
  diffWorkbookSpecs,
  validateWorkbookEditCandidate,
  validateWorkbookSpec,
} from './workbook-service.js';
import {
  ArtifactBusinessError,
  ARTIFACT_WORKBOOK_EDIT_SCOPE,
  ARTIFACT_WORKBOOK_SCHEMA_INVALID,
} from './artifact-business-errors.js';

const ENTERPRISE = '11111111-1111-7111-8111-111111111111';
const PROJECT = '22222222-2222-7222-8222-222222222222';
const WORKBOOK = '33333333-3333-7333-8333-333333333333';
const SCHEMA = '44444444-4444-7444-8444-444444444444';
const SCHEMA_VERSION = '55555555-5555-7555-8555-555555555555';

function schemaRef(): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: 'artifact.workbook_spec_schema',
    objectId: SCHEMA,
    versionId: SCHEMA_VERSION,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
  };
}

function workbook(): Artifact.CanonicalWorkbookSpec {
  return {
    workbookId: WORKBOOK,
    sheets: [
      {
        sheetId: 'suppliers',
        name: 'Suppliers',
        ordinal: 0,
        columns: [
          { columnId: 'supplier', name: 'Supplier', ordinal: 0, valueType: 'text' },
          { columnId: 'amount', name: 'Amount', ordinal: 1, valueType: 'number' },
          { columnId: 'total', name: 'Total', ordinal: 2, valueType: 'number' },
        ],
        rows: [
          {
            rowId: 'row-1',
            ordinal: 0,
            cells: [
              { cellId: 'name-1', columnId: 'supplier', valueType: 'text', value: 'Acme' },
              { cellId: 'amount-1', columnId: 'amount', valueType: 'number', value: 2 },
              {
                cellId: 'total-1',
                columnId: 'total',
                valueType: 'number',
                value: 2,
                formula: '=SUM(amount)',
              },
            ],
          },
          {
            rowId: 'row-2',
            ordinal: 1,
            cells: [
              { cellId: 'name-2', columnId: 'supplier', valueType: 'text', value: 'Beta' },
              { cellId: 'amount-2', columnId: 'amount', valueType: 'number', value: 3 },
              {
                cellId: 'total-2',
                columnId: 'total',
                valueType: 'number',
                value: 3,
                formula: '=SUM(amount)',
              },
            ],
          },
        ],
        validationRules: [
          { rule: 'required', columnId: 'supplier' },
          { rule: 'range', columnId: 'amount', min: 0 },
          {
            rule: 'extension',
            extensionId: 'vendor.optional-note',
            required: false,
            config: { label: 'retained-only' },
          },
        ],
        crossRecordRules: [
          { rule: 'unique', columnId: 'supplier' },
          {
            rule: 'compare',
            leftColumnId: 'amount',
            operator: 'LTE',
            rightColumnId: 'total',
          },
        ],
      },
    ],
    metadata: { locale: 'en-US' },
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

function mutableWorkbook(
  value: Artifact.CanonicalWorkbookSpec = workbook(),
): DeepMutable<Artifact.CanonicalWorkbookSpec> {
  return structuredClone(value) as DeepMutable<Artifact.CanonicalWorkbookSpec>;
}

function itemAt<Item>(items: readonly Item[], index: number, label: string): Item {
  const item = items[index];
  if (item === undefined) throw new Error(`missing ${label} at index ${index}`);
  return item;
}

function mutableSheet(workbookValue: DeepMutable<Artifact.CanonicalWorkbookSpec>) {
  return itemAt(workbookValue.sheets, 0, 'Sheet');
}

function mutableRow(sheet: DeepMutable<Artifact.CanonicalWorkbookSheet>, index: number) {
  return itemAt(sheet.rows, index, 'Row');
}

function mutableCell(row: DeepMutable<Artifact.CanonicalWorkbookRow>, index: number) {
  return itemAt(row.cells, index, 'Cell');
}

function expectSchemaError(action: () => unknown): void {
  expect(action).toThrow(ArtifactBusinessError);
  try {
    action();
  } catch (error) {
    expect((error as ArtifactBusinessError).code).toBe(ARTIFACT_WORKBOOK_SCHEMA_INVALID);
  }
}

describe('Artifact WI-07 WorkbookSpec validation and canonicalization', () => {
  it('normalizes physical order without changing canonical bytes or hash', () => {
    const first = canonicalizeWorkbookSpec(workbook(), schemaRef());
    const reordered = mutableWorkbook();
    const sheet = reordered.sheets[0];
    if (sheet === undefined) throw new Error('missing fixture sheet');
    const physicallyReordered: Artifact.CanonicalWorkbookSpec = {
      ...reordered,
      sheets: [
        {
          ...sheet,
          columns: [...sheet.columns].reverse(),
          rows: [...sheet.rows]
            .reverse()
            .map((row) => ({ ...row, cells: [...row.cells].reverse() })),
          validationRules: [...(sheet.validationRules ?? [])].reverse(),
          crossRecordRules: [...(sheet.crossRecordRules ?? [])].reverse(),
        },
      ],
    };
    const second = canonicalizeWorkbookSpec(physicallyReordered, schemaRef());

    expect(second.canonicalBytes).toEqual(first.canonicalBytes);
    expect(second.contentHash).toEqual(first.contentHash);
    expect(diffWorkbookSpecs(first.payload.body, second.payload.body).entries).toEqual([]);
  });

  it('rejects duplicate stable IDs and duplicate ordinals at every parent boundary', () => {
    const duplicateSheetOrdinal = mutableWorkbook();
    duplicateSheetOrdinal.sheets.push({
      ...clone(mutableSheet(duplicateSheetOrdinal)),
      sheetId: 'second-sheet',
    });
    expectSchemaError(() => validateWorkbookSpec(duplicateSheetOrdinal));

    const duplicateColumn = mutableWorkbook();
    const duplicateColumnSheet = mutableSheet(duplicateColumn);
    duplicateColumnSheet.columns.push(clone(itemAt(duplicateColumnSheet.columns, 0, 'Column')));
    expectSchemaError(() => validateWorkbookSpec(duplicateColumn));

    const duplicateRowOrdinal = mutableWorkbook();
    const duplicateRowSheet = mutableSheet(duplicateRowOrdinal);
    duplicateRowSheet.rows[1] = {
      ...mutableRow(duplicateRowSheet, 1),
      ordinal: 0,
    };
    expectSchemaError(() => validateWorkbookSpec(duplicateRowOrdinal));

    const duplicateCell = mutableWorkbook();
    const duplicateCellRow = mutableRow(mutableSheet(duplicateCell), 0);
    duplicateCellRow.cells.push(clone(mutableCell(duplicateCellRow, 0)));
    expectSchemaError(() => validateWorkbookSpec(duplicateCell));

    const coordinateId = mutableWorkbook();
    const coordinateRow = mutableRow(mutableSheet(coordinateId), 0);
    coordinateRow.cells[0] = {
      ...mutableCell(coordinateRow, 0),
      cellId: 'A1',
    };
    expectSchemaError(() => validateWorkbookSpec(coordinateId));
  });

  it('enforces same-sheet column, value-type, value, and declared-formula boundaries', () => {
    const unknownColumn = mutableWorkbook();
    const unknownColumnRow = mutableRow(mutableSheet(unknownColumn), 0);
    unknownColumnRow.cells[0] = {
      ...mutableCell(unknownColumnRow, 0),
      columnId: 'other-sheet-column',
    };
    expectSchemaError(() => validateWorkbookSpec(unknownColumn));

    const mismatchedType = mutableWorkbook();
    const mismatchedTypeRow = mutableRow(mutableSheet(mismatchedType), 0);
    mismatchedTypeRow.cells[1] = {
      ...mutableCell(mismatchedTypeRow, 1),
      valueType: 'text',
    };
    expectSchemaError(() => validateWorkbookSpec(mismatchedType));

    const wrongValue = mutableWorkbook();
    const wrongValueRow = mutableRow(mutableSheet(wrongValue), 0);
    wrongValueRow.cells[1] = {
      ...mutableCell(wrongValueRow, 1),
      value: 'two',
    };
    expectSchemaError(() => validateWorkbookSpec(wrongValue));

    for (const formula of ['=A1+1', '=Other!amount', '=[book]amount', '=SUM(missing)']) {
      const invalidFormula = mutableWorkbook();
      const invalidFormulaRow = mutableRow(mutableSheet(invalidFormula), 0);
      invalidFormulaRow.cells[2] = {
        ...mutableCell(invalidFormulaRow, 2),
        formula,
      };
      expectSchemaError(() => validateWorkbookSpec(invalidFormula));
    }
  });

  it('validates closed built-in rules and fails closed for unknown required extensions', () => {
    const malformedRange = mutableWorkbook();
    mutableSheet(malformedRange).validationRules = [
      { rule: 'range', columnId: 'amount', min: 10, max: 1 },
    ];
    expectSchemaError(() => validateWorkbookSpec(malformedRange));

    const unknownRequired = mutableWorkbook();
    mutableSheet(unknownRequired).validationRules = [
      { rule: 'extension', extensionId: 'vendor.required', required: true },
    ];
    expectSchemaError(() => validateWorkbookSpec(unknownRequired));

    expect(() =>
      validateWorkbookSpec(unknownRequired, { knownExtensionIds: ['vendor.required'] }),
    ).not.toThrow();
    expect(() =>
      diffWorkbookSpecs(workbook(), unknownRequired, {
        knownExtensionIds: ['vendor.required'],
      }),
    ).not.toThrow();
    expect(() =>
      validateWorkbookEditCandidate(
        workbook(),
        unknownRequired,
        [{ kind: 'SHEET', sheetId: 'suppliers' }],
        { knownExtensionIds: ['vendor.required'] },
      ),
    ).not.toThrow();
    expect(() => validateWorkbookSpec(workbook())).not.toThrow();
  });
});

describe('Artifact WI-07 deterministic Workbook Diff', () => {
  it('reports stable add/remove/change/move identities in deterministic order', () => {
    const before = validateWorkbookSpec(workbook());
    const candidate = mutableWorkbook(before);
    const sheet = mutableSheet(candidate);
    sheet.rows[0] = { ...mutableRow(sheet, 0), ordinal: 1 };
    sheet.rows[1] = {
      ...mutableRow(sheet, 1),
      ordinal: 0,
      cells: mutableRow(sheet, 1).cells.map((cell) =>
        cell.cellId === 'amount-2' ? { ...cell, value: 4 } : cell,
      ),
    };
    sheet.rows.push({
      rowId: 'row-3',
      ordinal: 2,
      cells: [{ cellId: 'name-3', columnId: 'supplier', valueType: 'text', value: 'Gamma' }],
    });

    const first = diffWorkbookSpecs(before, validateWorkbookSpec(candidate));
    const second = diffWorkbookSpecs(before, validateWorkbookSpec(candidate));

    expect(second).toEqual(first);
    expect(first.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: 'ROW', stableId: 'row-1', kind: 'MOVED' }),
        expect.objectContaining({ entityType: 'ROW', stableId: 'row-2', kind: 'MOVED' }),
        expect.objectContaining({ entityType: 'ROW', stableId: 'row-3', kind: 'ADDED' }),
        expect.objectContaining({ entityType: 'CELL', stableId: 'amount-2', kind: 'CHANGED' }),
      ]),
    );
  });

  it('requires exact hierarchical authorization and forbids Column definition edits', () => {
    const before = validateWorkbookSpec(workbook());
    const cellEdit = mutableWorkbook(before);
    const cellEditRow = mutableRow(mutableSheet(cellEdit), 1);
    cellEditRow.cells[1] = {
      ...mutableCell(cellEditRow, 1),
      value: 4,
    };

    expect(
      validateWorkbookEditCandidate(before, cellEdit, [
        { kind: 'CELL', sheetId: 'suppliers', rowId: 'row-2', cellId: 'amount-2' },
      ]).entries,
    ).toEqual([
      expect.objectContaining({ entityType: 'CELL', stableId: 'amount-2', kind: 'CHANGED' }),
    ]);
    expect(() =>
      validateWorkbookEditCandidate(before, cellEdit, [
        { kind: 'CELL', sheetId: 'suppliers', rowId: 'row-1', cellId: 'amount-1' },
      ]),
    ).toThrow(expect.objectContaining({ code: ARTIFACT_WORKBOOK_EDIT_SCOPE }));

    const columnEdit = mutableWorkbook(before);
    const columnEditSheet = mutableSheet(columnEdit);
    columnEditSheet.columns[1] = {
      ...itemAt(columnEditSheet.columns, 1, 'Column'),
      name: 'Declared amount changed',
    };
    expect(() =>
      validateWorkbookEditCandidate(before, columnEdit, [{ kind: 'SHEET', sheetId: 'suppliers' }]),
    ).toThrow(expect.objectContaining({ code: ARTIFACT_WORKBOOK_EDIT_SCOPE }));

    const metadataEdit = mutableWorkbook(before);
    metadataEdit.metadata = { locale: 'zh-CN' };
    expect(() =>
      validateWorkbookEditCandidate(before, metadataEdit, [
        { kind: 'SHEET', sheetId: 'suppliers' },
      ]),
    ).toThrow(expect.objectContaining({ code: ARTIFACT_WORKBOOK_EDIT_SCOPE }));

    expect(() =>
      validateWorkbookEditCandidate(before, cellEdit, [
        { kind: 'CELL', sheetId: 'suppliers', rowId: 'missing-row', cellId: 'missing-cell' },
      ]),
    ).toThrow(expect.objectContaining({ code: ARTIFACT_WORKBOOK_EDIT_SCOPE }));
  });
});
