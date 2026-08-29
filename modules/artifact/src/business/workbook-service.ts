// IM-04 WI-07 (issue #96): WorkbookSpec validation, canonicalization, scoped
// Human Edit orchestration and rebuildable internal Diff.

import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import { ContractRegistry, type Artifact, type Common } from '@zhiju/contracts';
import {
  canonicalize,
  canonicalizeCanonicalContentPayload,
  hashCanonicalContentPayload,
  isUuidV7,
  type CanonicalContentPayload as SharedCanonicalContentPayload,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import {
  withArtifactTransaction,
  type ArtifactDb,
  type ArtifactTransactionContext,
} from '../persistence/artifact-db.js';
import { ArtifactRepository } from '../persistence/artifact-repository.js';
import type {
  ArtifactContentObjectTable,
  ArtifactRevisionTable,
} from '../persistence/artifact-business-types.js';
import {
  ArtifactBusinessError,
  ARTIFACT_CONTENT_FINALIZATION_UNKNOWN,
  ARTIFACT_CONTENT_HASH_MISMATCH,
  ARTIFACT_CONTENT_READBACK_MISMATCH,
  ARTIFACT_CONTENT_STATE_INVALID,
  ARTIFACT_HUMAN_ONLY_DENIED,
  ARTIFACT_NOT_ACTIVE,
  ARTIFACT_QUERY_NOT_FOUND,
  ARTIFACT_QUERY_SCOPE_MISMATCH,
  ARTIFACT_SCOPE_INVALID,
  ARTIFACT_WORKBOOK_BASE_INVALID,
  ARTIFACT_WORKBOOK_BASE_STALE,
  ARTIFACT_WORKBOOK_EDIT_SCOPE,
  ARTIFACT_WORKBOOK_ID_MISMATCH,
  ARTIFACT_WORKBOOK_NOOP,
  ARTIFACT_WORKBOOK_SCHEMA_INVALID,
} from './artifact-business-errors.js';
import {
  assertEnvelopeMatchesContext,
  type CommandEnvelope,
  type CommandResult,
} from '../persistence/command-runner.js';
import {
  freezeCanonicalContent,
  linkCanonicalContent,
  stageCanonicalContent,
  type CanonicalContentCommandEnvelope,
  type LinkCanonicalContentPayload,
  type StageCanonicalContentPayload,
} from './content-object-service.js';
import {
  handleCreateAndSealRevision,
  handleGetRevisionDiffInputs,
  handleGetRevisionSnapshot,
  type CreateAndSealRevisionPayload,
  type GetRevisionDiffInputsPayload,
  type RevisionCommandEnvelope,
} from './revision-service.js';
import type { ObjectStoragePort, ObjectStorageReadback } from '../storage/object-storage.js';

const repo = new ArtifactRepository();
const registry = new ContractRegistry();
const ROOT_OBJECT_TYPES = new Set(['Artifact', 'artifact.artifact']);
const REVISION_OBJECT_TYPES = new Set(['ArtifactRevision', 'artifact.artifact_revision']);
const ROOT_OBJECT_TYPE = 'Artifact';
const REVISION_OBJECT_TYPE = 'ArtifactRevision';
const CANONICAL_OBJECT_TYPE = 'CanonicalContentObject';
const CANONICAL_MEDIA_TYPE = 'application/json';
const WORKBOOK_SCHEMA_OBJECT_TYPE = 'artifact.workbook_spec_schema';
const SYNTHETIC_SCHEMA_REF: Common.VersionedRef = {
  kind: 'VERSIONED',
  objectType: WORKBOOK_SCHEMA_OBJECT_TYPE,
  objectId: '00000000-0000-7000-8000-000000000001',
  versionId: '00000000-0000-7000-8000-000000000002',
  scope: { enterpriseId: '00000000-0000-7000-8000-000000000003' },
};
const VALUE_TYPES = new Set(['text', 'number', 'boolean', 'date', 'datetime', 'json']);
const FORMULA_FUNCTIONS = new Set([
  'ABS',
  'AND',
  'AVG',
  'COUNT',
  'IF',
  'MAX',
  'MIN',
  'NOT',
  'OR',
  'ROUND',
  'SUM',
  'TRUE',
  'FALSE',
]);
const COMPARE_OPERATORS = new Set(['EQ', 'NE', 'LT', 'LTE', 'GT', 'GTE']);

type RecordLike = Readonly<Record<string, unknown>>;

export interface WorkbookValidationOptions {
  readonly knownExtensionIds?: readonly string[];
}

export interface WorkbookCanonicalization {
  readonly payload: Artifact.CanonicalWorkbookContent;
  readonly canonicalBytes: Buffer;
  readonly contentHash: Common.ContentHash;
}

export type WorkbookDiffKind = 'ADDED' | 'REMOVED' | 'CHANGED' | 'MOVED';
export type WorkbookEntityType = 'SHEET' | 'COLUMN' | 'ROW' | 'CELL';

export interface WorkbookEntityLocation {
  readonly sheetId?: string;
  readonly columnId?: string;
  readonly rowId?: string;
  readonly ordinal?: number;
}

export interface WorkbookDiffEntry {
  readonly kind: WorkbookDiffKind;
  readonly entityType: WorkbookEntityType;
  readonly stableId: string;
  readonly stablePath: string;
  readonly from?: WorkbookEntityLocation;
  readonly to?: WorkbookEntityLocation;
}

export interface WorkbookDiff {
  readonly workbookId: string;
  readonly workbookChanged: boolean;
  readonly entries: readonly WorkbookDiffEntry[];
}

export type WorkbookAllowedRef =
  | { readonly kind: 'SHEET'; readonly sheetId: string }
  | { readonly kind: 'ROW'; readonly sheetId: string; readonly rowId: string }
  | {
      readonly kind: 'CELL';
      readonly sheetId: string;
      readonly rowId: string;
      readonly cellId: string;
    };

export interface WorkbookEditPayload {
  readonly baseRevisionRef: Common.ContentAddressedRef;
  readonly allowedRefs: readonly WorkbookAllowedRef[];
  readonly workbook: Artifact.CanonicalWorkbookSpec;
  readonly changeSummary: Common.NonEmptyString;
}

export type WorkbookEditCommandEnvelope = CommandEnvelope & {
  readonly payload: WorkbookEditPayload;
};

export interface WorkbookEditResult {
  readonly baseRevisionRef: Common.ContentAddressedRef;
  readonly revision: Artifact.RevisionSnapshot;
  readonly contentObjectId: string;
  readonly contentRef: string;
  readonly canonicalBytes: string;
  readonly contentHash: Common.ContentHash;
  readonly diff: WorkbookDiff;
}

export interface WorkbookDiffResult {
  readonly inputs: Artifact.RevisionDiffInputs;
  readonly diff: WorkbookDiff;
  readonly leftCanonicalBytes: string;
  readonly rightCanonicalBytes: string;
}

interface ExactRevisionFacts {
  readonly ref: Common.ContentAddressedRef;
  readonly revision: ArtifactRevisionTable;
  readonly root: {
    readonly artifact_id: string;
    readonly enterprise_id: string;
    readonly project_id: string | null;
    readonly lifecycle_status: Artifact.ArtifactLifecycle;
  };
  readonly branch: {
    readonly artifact_id: string;
    readonly branch_id: string;
    readonly project_id: string | null;
    readonly head_version: string;
    readonly working_head_ref: unknown;
  };
  readonly contentObject: ArtifactContentObjectTable;
  readonly schemaRef: Common.VersionedRef;
  readonly disposition: Artifact.RevisionDisposition;
}

interface WorkbookRead {
  readonly workbook: Artifact.CanonicalWorkbookSpec;
  readonly canonicalBytes: Buffer;
  readonly contentHash: Common.ContentHash;
}

interface IndexedWorkbookEntity {
  readonly entityType: WorkbookEntityType;
  readonly stableId: string;
  readonly stablePath: string;
  readonly location: WorkbookEntityLocation;
  readonly contentFingerprint: string;
}

function record(value: unknown): RecordLike {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordLike)
    : {};
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function schemaError(message: string): never {
  throw new ArtifactBusinessError(ARTIFACT_WORKBOOK_SCHEMA_INVALID, message);
}

function canonicalJsonClone<T>(value: T): T {
  try {
    const canonicalJson = canonicalize(value as unknown as CanonicalJsonValue);
    const parsed: unknown = JSON.parse(canonicalJson);
    return parsed as T;
  } catch {
    return schemaError('WorkbookSpec value is not valid canonical JSON');
  }
}

function normalizeSchemaRef(
  value: unknown,
  context?: ArtifactTransactionContext,
  expectedProjectId?: string,
): Common.VersionedRef {
  const ref = record(value);
  const scope = record(ref.scope);
  const enterpriseId = scope.enterpriseId;
  const projectId = scope.projectId;
  if (
    ref.kind !== 'VERSIONED' ||
    ref.objectType !== WORKBOOK_SCHEMA_OBJECT_TYPE ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    typeof ref.versionId !== 'string' ||
    !isUuidV7(ref.versionId) ||
    typeof enterpriseId !== 'string' ||
    !isUuidV7(enterpriseId) ||
    (projectId !== undefined && (typeof projectId !== 'string' || !isUuidV7(projectId)))
  ) {
    return schemaError('WorkbookSpec schemaRef is not an exact Workbook Schema VersionedRef');
  }
  if (context !== undefined) {
    if (enterpriseId !== context.enterpriseId) {
      throw new ArtifactBusinessError(
        ARTIFACT_SCOPE_INVALID,
        'WorkbookSpec schemaRef is outside the trusted Enterprise',
      );
    }
    if (projectId !== undefined && !context.allowedProjectIds.includes(projectId)) {
      throw new ArtifactBusinessError(
        ARTIFACT_QUERY_NOT_FOUND,
        'WorkbookSpec schemaRef is outside the trusted Project scope',
      );
    }
  }
  if (
    expectedProjectId !== undefined &&
    projectId !== undefined &&
    projectId !== expectedProjectId
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_QUERY_SCOPE_MISMATCH,
      'WorkbookSpec schemaRef Project scope does not match the Artifact scope',
    );
  }
  return {
    kind: 'VERSIONED',
    objectType: WORKBOOK_SCHEMA_OBJECT_TYPE,
    objectId: ref.objectId,
    versionId: ref.versionId,
    scope: projectId === undefined ? { enterpriseId } : { enterpriseId, projectId },
  };
}

function assertUnique(values: readonly RecordLike[], key: string, label: string): void {
  const seen = new Set<unknown>();
  for (const value of values) {
    const current = value[key];
    if (seen.has(current)) return schemaError(`${label} contains duplicate ${key}`);
    seen.add(current);
  }
}

function assertUniqueOrdinals(values: readonly RecordLike[], label: string): void {
  const seen = new Set<unknown>();
  for (const value of values) {
    if (seen.has(value.ordinal)) return schemaError(`${label} contains duplicate ordinal`);
    seen.add(value.ordinal);
  }
}

function assertStableBusinessId(value: string, label: string): void {
  if (/^[A-Z]{1,3}[1-9][0-9]*$/u.test(value)) {
    return schemaError(`${label} cannot use an Excel coordinate as a stable business ID`);
  }
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isIsoDateTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function assertValueType(valueType: string, value: unknown, label: string): void {
  if (!VALUE_TYPES.has(valueType)) return schemaError(`${label} has an unsupported valueType`);
  if (value === undefined || valueType === 'json') return;
  const valid =
    (valueType === 'text' && typeof value === 'string') ||
    (valueType === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
    (valueType === 'boolean' && typeof value === 'boolean') ||
    (valueType === 'date' && isIsoDate(value)) ||
    (valueType === 'datetime' && isIsoDateTime(value));
  if (!valid) return schemaError(`${label}.value does not match declared valueType`);
}

function assertFormula(formula: string, columnIds: ReadonlySet<string>, label: string): void {
  if (
    !formula.startsWith('=') ||
    formula.includes('!') ||
    formula.includes('[') ||
    formula.includes(']') ||
    /\b[A-Z]{1,3}[1-9][0-9]*\b/u.test(formula)
  ) {
    return schemaError(`${label}.formula uses forbidden coordinate or external reference syntax`);
  }
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
      if (parentheses < 0) return schemaError(`${label}.formula has unbalanced parentheses`);
    }
  }
  if (inString || parentheses !== 0) {
    return schemaError(`${label}.formula has unbalanced parentheses or strings`);
  }
  const expressionWithoutStrings = formula.replace(/"(?:[^"\\]|\\.)*"/gu, '');
  for (const match of expressionWithoutStrings.matchAll(/[A-Za-z_][A-Za-z0-9_.-]*/gu)) {
    const identifier = match[0];
    if (!FORMULA_FUNCTIONS.has(identifier.toUpperCase()) && !columnIds.has(identifier)) {
      return schemaError(`${label}.formula references an unknown same-sheet Column`);
    }
  }
}

function assertClosedKeys(
  value: RecordLike,
  allowed: ReadonlySet<string>,
  label: string,
  code = ARTIFACT_WORKBOOK_SCHEMA_INVALID,
): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new ArtifactBusinessError(code, `${label} contains an unsupported field`);
  }
}

function nonEmptyRuleColumn(value: unknown, columnIds: ReadonlySet<string>, label: string): string {
  if (typeof value !== 'string' || !columnIds.has(value)) {
    return schemaError(`${label} references an unknown same-sheet Column`);
  }
  return value;
}

function validateRule(
  ruleValue: CanonicalJsonValue,
  kind: 'VALIDATION' | 'CROSS_RECORD',
  columnIds: ReadonlySet<string>,
  knownExtensionIds: ReadonlySet<string>,
  label: string,
): void {
  const rule = record(ruleValue);
  if (typeof rule.rule !== 'string') return schemaError(`${label}.rule must be non-empty`);
  if (rule.rule === 'extension') {
    assertClosedKeys(rule, new Set(['rule', 'extensionId', 'required', 'config']), label);
    if (
      typeof rule.extensionId !== 'string' ||
      rule.extensionId.trim().length === 0 ||
      typeof rule.required !== 'boolean'
    ) {
      return schemaError(`${label} extension declaration is malformed`);
    }
    if (rule.required && !knownExtensionIds.has(rule.extensionId)) {
      return schemaError(`${label} requires an unknown extension`);
    }
    return;
  }
  if (kind === 'VALIDATION' && rule.rule === 'required') {
    assertClosedKeys(rule, new Set(['rule', 'columnId']), label);
    nonEmptyRuleColumn(rule.columnId, columnIds, label);
    return;
  }
  if (kind === 'VALIDATION' && rule.rule === 'range') {
    assertClosedKeys(rule, new Set(['rule', 'columnId', 'min', 'max']), label);
    nonEmptyRuleColumn(rule.columnId, columnIds, label);
    if (
      (rule.min === undefined && rule.max === undefined) ||
      (rule.min !== undefined && (typeof rule.min !== 'number' || !Number.isFinite(rule.min))) ||
      (rule.max !== undefined && (typeof rule.max !== 'number' || !Number.isFinite(rule.max))) ||
      (typeof rule.min === 'number' && typeof rule.max === 'number' && rule.min > rule.max)
    ) {
      return schemaError(`${label} range bounds are malformed`);
    }
    return;
  }
  if (kind === 'VALIDATION' && rule.rule === 'pattern') {
    assertClosedKeys(rule, new Set(['rule', 'columnId', 'pattern']), label);
    nonEmptyRuleColumn(rule.columnId, columnIds, label);
    if (typeof rule.pattern !== 'string' || rule.pattern.length === 0) {
      return schemaError(`${label}.pattern must be non-empty`);
    }
    try {
      new RegExp(rule.pattern, 'u');
    } catch {
      return schemaError(`${label}.pattern must be a valid Unicode regular expression`);
    }
    return;
  }
  if (kind === 'CROSS_RECORD' && rule.rule === 'unique') {
    assertClosedKeys(rule, new Set(['rule', 'columnId']), label);
    nonEmptyRuleColumn(rule.columnId, columnIds, label);
    return;
  }
  if (kind === 'CROSS_RECORD' && rule.rule === 'compare') {
    assertClosedKeys(rule, new Set(['rule', 'leftColumnId', 'operator', 'rightColumnId']), label);
    nonEmptyRuleColumn(rule.leftColumnId, columnIds, label);
    nonEmptyRuleColumn(rule.rightColumnId, columnIds, label);
    if (typeof rule.operator !== 'string' || !COMPARE_OPERATORS.has(rule.operator)) {
      return schemaError(`${label}.operator is not supported`);
    }
    return;
  }
  return schemaError(`${label} uses an unsupported built-in rule`);
}

function normalizeWorkbook(
  workbook: Artifact.CanonicalWorkbookSpec,
  schemaRef: Common.VersionedRef,
  context?: ArtifactTransactionContext,
  expectedProjectId?: string,
  options: WorkbookValidationOptions = {},
): Artifact.CanonicalWorkbookSpec {
  const cloned = canonicalJsonClone(workbook);
  if (!isUuidV7(cloned.workbookId)) return schemaError('WorkbookSpec workbookId must be a UUIDv7');
  const normalizedSchema = normalizeSchemaRef(schemaRef, context, expectedProjectId);
  const validation = registry.validateCanonicalContent({
    schemaRef: normalizedSchema,
    contentType: 'WORKBOOK_SPEC',
    canonicalizationVersion: '1',
    body: cloned,
  });
  if (!validation.valid) {
    return schemaError('WorkbookSpec failed executable schema or structural invariant validation');
  }
  const sheetRecords = cloned.sheets.map((sheet) => record(sheet));
  assertUnique(sheetRecords, 'sheetId', 'WorkbookSpec sheets');
  assertUniqueOrdinals(sheetRecords, 'WorkbookSpec sheets');
  const knownExtensionIds = new Set(options.knownExtensionIds ?? []);
  const normalizedSheets = cloned.sheets
    .map((sheet, sheetIndex): Artifact.CanonicalWorkbookSheet => {
      assertStableBusinessId(sheet.sheetId, `WorkbookSpec sheet ${sheetIndex} sheetId`);
      const columnRecords = sheet.columns.map((column) => record(column));
      const rowRecords = sheet.rows.map((row) => record(row));
      assertUnique(columnRecords, 'columnId', `WorkbookSpec sheet ${sheetIndex} columns`);
      assertUniqueOrdinals(columnRecords, `WorkbookSpec sheet ${sheetIndex} columns`);
      assertUnique(rowRecords, 'rowId', `WorkbookSpec sheet ${sheetIndex} rows`);
      assertUniqueOrdinals(rowRecords, `WorkbookSpec sheet ${sheetIndex} rows`);
      const columnById = new Map(sheet.columns.map((column) => [column.columnId, column]));
      for (const [columnIndex, column] of sheet.columns.entries()) {
        assertStableBusinessId(
          column.columnId,
          `WorkbookSpec sheet ${sheetIndex} column ${columnIndex} columnId`,
        );
      }
      const columnIds = new Set(columnById.keys());
      for (const [ruleIndex, rule] of (sheet.validationRules ?? []).entries()) {
        validateRule(
          rule,
          'VALIDATION',
          columnIds,
          knownExtensionIds,
          `WorkbookSpec sheet ${sheetIndex} validationRules ${ruleIndex}`,
        );
      }
      for (const [ruleIndex, rule] of (sheet.crossRecordRules ?? []).entries()) {
        validateRule(
          rule,
          'CROSS_RECORD',
          columnIds,
          knownExtensionIds,
          `WorkbookSpec sheet ${sheetIndex} crossRecordRules ${ruleIndex}`,
        );
      }
      const normalizedColumns = [...sheet.columns].sort(
        (left, right) => left.ordinal - right.ordinal || compareUtf8(left.columnId, right.columnId),
      );
      const columnOrdinal = new Map(
        normalizedColumns.map((column, index) => [column.columnId, index]),
      );
      const normalizedRows = sheet.rows
        .map((row, rowIndex): Artifact.CanonicalWorkbookRow => {
          assertStableBusinessId(
            row.rowId,
            `WorkbookSpec sheet ${sheetIndex} row ${rowIndex} rowId`,
          );
          const cellRecords = row.cells.map((cell) => record(cell));
          assertUnique(
            cellRecords,
            'cellId',
            `WorkbookSpec sheet ${sheetIndex} row ${rowIndex} cells`,
          );
          const seenColumns = new Set<string>();
          for (const [cellIndex, cell] of row.cells.entries()) {
            assertStableBusinessId(
              cell.cellId,
              `WorkbookSpec sheet ${sheetIndex} row ${rowIndex} cell ${cellIndex} cellId`,
            );
            const column = columnById.get(cell.columnId);
            if (column === undefined) {
              return schemaError(
                `WorkbookSpec sheet ${sheetIndex} row ${rowIndex} cell ${cellIndex} references another or unknown Sheet Column`,
              );
            }
            if (seenColumns.has(cell.columnId)) {
              return schemaError(
                `WorkbookSpec sheet ${sheetIndex} row ${rowIndex} contains duplicate Column cells`,
              );
            }
            seenColumns.add(cell.columnId);
            if (cell.valueType !== column.valueType) {
              return schemaError(
                `WorkbookSpec sheet ${sheetIndex} row ${rowIndex} cell ${cellIndex} valueType does not match its Column`,
              );
            }
            assertValueType(
              cell.valueType,
              cell.value,
              `WorkbookSpec sheet ${sheetIndex} row ${rowIndex} cell ${cellIndex}`,
            );
            if (cell.formula !== undefined) {
              assertFormula(
                cell.formula,
                columnIds,
                `WorkbookSpec sheet ${sheetIndex} row ${rowIndex} cell ${cellIndex}`,
              );
            }
          }
          return {
            ...row,
            cells: [...row.cells].sort((left, right) => {
              return (
                (columnOrdinal.get(left.columnId) ?? Number.MAX_SAFE_INTEGER) -
                  (columnOrdinal.get(right.columnId) ?? Number.MAX_SAFE_INTEGER) ||
                compareUtf8(left.cellId, right.cellId)
              );
            }),
          };
        })
        .sort(
          (left, right) => left.ordinal - right.ordinal || compareUtf8(left.rowId, right.rowId),
        );
      const validationRules = [...(sheet.validationRules ?? [])].sort((left, right) =>
        compareUtf8(canonicalize(left), canonicalize(right)),
      );
      const crossRecordRules = [...(sheet.crossRecordRules ?? [])].sort((left, right) =>
        compareUtf8(canonicalize(left), canonicalize(right)),
      );
      return {
        sheetId: sheet.sheetId,
        name: sheet.name,
        ordinal: sheet.ordinal,
        columns: normalizedColumns,
        rows: normalizedRows,
        ...(sheet.validationRules === undefined ? {} : { validationRules }),
        ...(sheet.crossRecordRules === undefined ? {} : { crossRecordRules }),
      };
    })
    .sort(
      (left, right) => left.ordinal - right.ordinal || compareUtf8(left.sheetId, right.sheetId),
    );
  return canonicalJsonClone({
    workbookId: cloned.workbookId,
    sheets: normalizedSheets,
    ...(cloned.metadata === undefined ? {} : { metadata: cloned.metadata }),
  } satisfies Artifact.CanonicalWorkbookSpec);
}

export function validateWorkbookSpec(
  workbook: Artifact.CanonicalWorkbookSpec,
  options: WorkbookValidationOptions = {},
): Artifact.CanonicalWorkbookSpec {
  return normalizeWorkbook(workbook, SYNTHETIC_SCHEMA_REF, undefined, undefined, options);
}

export function canonicalizeWorkbookSpec(
  workbook: Artifact.CanonicalWorkbookSpec,
  schemaRef: Common.VersionedRef,
  context?: ArtifactTransactionContext,
  expectedProjectId?: string,
  options: WorkbookValidationOptions = {},
): WorkbookCanonicalization {
  const normalizedSchema = normalizeSchemaRef(schemaRef, context, expectedProjectId);
  const normalizedWorkbook = normalizeWorkbook(
    workbook,
    normalizedSchema,
    context,
    expectedProjectId,
    options,
  );
  const payload: Artifact.CanonicalWorkbookContent = {
    schemaRef: normalizedSchema,
    contentType: 'WORKBOOK_SPEC',
    canonicalizationVersion: '1',
    body: normalizedWorkbook,
  };
  const hashablePayload = payload as unknown as SharedCanonicalContentPayload;
  return {
    payload,
    canonicalBytes: Buffer.from(canonicalizeCanonicalContentPayload(hashablePayload), 'utf8'),
    contentHash: hashCanonicalContentPayload(hashablePayload),
  };
}

function fingerprint(value: CanonicalJsonValue): string {
  return canonicalize(value);
}

function indexWorkbook(
  workbook: Artifact.CanonicalWorkbookSpec,
): Map<string, IndexedWorkbookEntity> {
  const indexed = new Map<string, IndexedWorkbookEntity>();
  for (const sheet of workbook.sheets) {
    const sheetPath = `sheet/${sheet.sheetId}`;
    indexed.set(sheetPath, {
      entityType: 'SHEET',
      stableId: sheet.sheetId,
      stablePath: sheetPath,
      location: { sheetId: sheet.sheetId, ordinal: sheet.ordinal },
      contentFingerprint: fingerprint({
        name: sheet.name,
        validationRules: sheet.validationRules ?? [],
        crossRecordRules: sheet.crossRecordRules ?? [],
      }),
    });
    for (const column of sheet.columns) {
      const stablePath = `${sheetPath}/column/${column.columnId}`;
      indexed.set(stablePath, {
        entityType: 'COLUMN',
        stableId: column.columnId,
        stablePath,
        location: { sheetId: sheet.sheetId, columnId: column.columnId, ordinal: column.ordinal },
        contentFingerprint: fingerprint({ name: column.name, valueType: column.valueType }),
      });
    }
    for (const row of sheet.rows) {
      const rowPath = `${sheetPath}/row/${row.rowId}`;
      indexed.set(rowPath, {
        entityType: 'ROW',
        stableId: row.rowId,
        stablePath: rowPath,
        location: { sheetId: sheet.sheetId, rowId: row.rowId, ordinal: row.ordinal },
        contentFingerprint: fingerprint({ rowId: row.rowId }),
      });
      for (const cell of row.cells) {
        const stablePath = `${rowPath}/cell/${cell.cellId}`;
        indexed.set(stablePath, {
          entityType: 'CELL',
          stableId: cell.cellId,
          stablePath,
          location: {
            sheetId: sheet.sheetId,
            rowId: row.rowId,
            columnId: cell.columnId,
          },
          contentFingerprint: fingerprint({
            value: cell.value ?? null,
            valueType: cell.valueType,
            formula: cell.formula ?? null,
          }),
        });
      }
    }
  }
  return indexed;
}

const ENTITY_ORDER: Readonly<Record<WorkbookEntityType, number>> = {
  SHEET: 0,
  COLUMN: 1,
  ROW: 2,
  CELL: 3,
};
const DIFF_ORDER: Readonly<Record<WorkbookDiffKind, number>> = {
  ADDED: 0,
  REMOVED: 1,
  CHANGED: 2,
  MOVED: 3,
};

export function diffWorkbookSpecs(
  left: Artifact.CanonicalWorkbookSpec,
  right: Artifact.CanonicalWorkbookSpec,
  options: WorkbookValidationOptions = {},
): WorkbookDiff {
  if (left.workbookId !== right.workbookId) {
    return schemaError('Workbook Diff requires the same workbookId');
  }
  const normalizedLeft = validateWorkbookSpec(left, options);
  const normalizedRight = validateWorkbookSpec(right, options);
  const leftIndex = indexWorkbook(normalizedLeft);
  const rightIndex = indexWorkbook(normalizedRight);
  const stablePaths = [...new Set([...leftIndex.keys(), ...rightIndex.keys()])].sort(compareUtf8);
  const entries: WorkbookDiffEntry[] = [];
  for (const stablePath of stablePaths) {
    const before = leftIndex.get(stablePath);
    const after = rightIndex.get(stablePath);
    if (before === undefined && after !== undefined) {
      entries.push({
        kind: 'ADDED',
        entityType: after.entityType,
        stableId: after.stableId,
        stablePath,
        to: after.location,
      });
      continue;
    }
    if (before !== undefined && after === undefined) {
      entries.push({
        kind: 'REMOVED',
        entityType: before.entityType,
        stableId: before.stableId,
        stablePath,
        from: before.location,
      });
      continue;
    }
    if (before === undefined || after === undefined) continue;
    const changed = before.contentFingerprint !== after.contentFingerprint;
    const moved =
      fingerprint(before.location as unknown as CanonicalJsonValue) !==
      fingerprint(after.location as unknown as CanonicalJsonValue);
    if (changed || moved) {
      entries.push({
        kind: changed ? 'CHANGED' : 'MOVED',
        entityType: after.entityType,
        stableId: after.stableId,
        stablePath,
        from: before.location,
        to: after.location,
      });
    }
  }
  entries.sort((leftEntry, rightEntry) => {
    return (
      ENTITY_ORDER[leftEntry.entityType] - ENTITY_ORDER[rightEntry.entityType] ||
      compareUtf8(leftEntry.stablePath, rightEntry.stablePath) ||
      DIFF_ORDER[leftEntry.kind] - DIFF_ORDER[rightEntry.kind]
    );
  });
  return {
    workbookId: normalizedLeft.workbookId,
    workbookChanged:
      fingerprint(normalizedLeft.metadata ?? null) !==
      fingerprint(normalizedRight.metadata ?? null),
    entries,
  };
}

function storedJson(value: unknown, label: string): CanonicalJsonValue {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, `${label} is invalid stored JSON`);
    }
  }
  try {
    const canonicalJson = canonicalize(parsed as CanonicalJsonValue);
    const normalized: unknown = JSON.parse(canonicalJson);
    return normalized as CanonicalJsonValue;
  } catch {
    throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, `${label} is invalid stored JSON`);
  }
}

function normalizedContentHash(value: unknown, label: string): Common.ContentHash {
  const hash = record(value);
  if (
    hash.algorithm !== 'SHA-256' ||
    hash.canonicalizationVersion !== '1' ||
    typeof hash.digest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(hash.digest)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_HASH_MISMATCH,
      `${label} must be a lowercase SHA-256 hash in canonicalization version 1`,
    );
  }
  return {
    algorithm: 'SHA-256',
    digest: hash.digest,
    canonicalizationVersion: '1',
  };
}

function rootScope(root: { enterprise_id: string; project_id: string | null }): Common.ScopeRef {
  return root.project_id === null
    ? { enterpriseId: root.enterprise_id }
    : { enterpriseId: root.enterprise_id, projectId: root.project_id };
}

function artifactRefForRoot(root: {
  artifact_id: string;
  enterprise_id: string;
  project_id: string | null;
}): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: ROOT_OBJECT_TYPE,
    objectId: root.artifact_id,
    scope: rootScope(root),
  };
}

function exactRevisionRef(
  value: unknown,
  context: ArtifactTransactionContext,
): Common.ContentAddressedRef {
  const ref = record(value);
  const scope = record(ref.scope);
  const enterpriseId = scope.enterpriseId;
  const projectId = scope.projectId;
  const contentHash = normalizedContentHash(ref.contentHash, 'baseRevisionRef.contentHash');
  if (
    ref.kind !== 'CONTENT_ADDRESSED' ||
    typeof ref.objectType !== 'string' ||
    !REVISION_OBJECT_TYPES.has(ref.objectType) ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    typeof enterpriseId !== 'string' ||
    enterpriseId !== context.enterpriseId ||
    (projectId !== undefined &&
      (typeof projectId !== 'string' ||
        !isUuidV7(projectId) ||
        !context.allowedProjectIds.includes(projectId))) ||
    (projectId === undefined && 'projectId' in scope) ||
    (ref.immutableVersionId !== undefined &&
      (typeof ref.immutableVersionId !== 'string' || !isUuidV7(ref.immutableVersionId)))
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_WORKBOOK_BASE_INVALID,
      'baseRevisionRef must be an exact visible ArtifactRevision ContentAddressedRef',
    );
  }
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: REVISION_OBJECT_TYPE,
    objectId: ref.objectId,
    ...(ref.immutableVersionId === undefined ? {} : { immutableVersionId: ref.immutableVersionId }),
    scope: projectId === undefined ? { enterpriseId } : { enterpriseId, projectId },
    contentHash,
  };
}

function revisionDisposition(
  governance: Awaited<ReturnType<ArtifactRepository['getRevisionGovernance']>>,
): Artifact.RevisionDisposition {
  return governance.invalidation !== undefined
    ? 'INVALIDATED'
    : governance.withdrawal !== undefined
      ? 'WITHDRAWN'
      : 'ACTIVE';
}

async function readExactRevisionFacts(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  value: unknown,
  requireCurrentHead: boolean,
  requireActiveArtifact = true,
): Promise<ExactRevisionFacts> {
  const ref = exactRevisionRef(value, context);
  return withArtifactTransaction(db, context, async (trx) => {
    const revision = await repo.getRevisionById(trx, ref.objectId);
    if (revision === undefined) {
      throw new ArtifactBusinessError(
        ARTIFACT_WORKBOOK_BASE_INVALID,
        'exact base Revision is not visible',
      );
    }
    const root = await repo.getArtifactById(trx, revision.artifact_id);
    if (root === undefined) {
      throw new ArtifactBusinessError(
        ARTIFACT_WORKBOOK_BASE_INVALID,
        'exact base Artifact is not visible',
      );
    }
    if (
      root.enterprise_id !== context.enterpriseId ||
      (ref.scope.projectId ?? undefined) !== (root.project_id ?? undefined)
    ) {
      throw new ArtifactBusinessError(
        ARTIFACT_WORKBOOK_BASE_INVALID,
        'base Revision Scope does not match the authoritative Artifact Scope',
      );
    }
    if (!revision.content_hash.equals(Buffer.from(ref.contentHash.digest, 'hex'))) {
      throw new ArtifactBusinessError(
        ARTIFACT_WORKBOOK_BASE_INVALID,
        'base Revision contentHash does not match the immutable Revision',
      );
    }
    if (requireActiveArtifact && root.lifecycle_status !== 'ACTIVE') {
      throw new ArtifactBusinessError(ARTIFACT_NOT_ACTIVE, 'base Artifact is not active');
    }
    if (revision.content_type !== 'WORKBOOK_SPEC') {
      throw new ArtifactBusinessError(
        ARTIFACT_WORKBOOK_BASE_INVALID,
        'base Revision is not a WorkbookSpec',
      );
    }
    const branchResult: unknown = await repo.getArtifactBranchById(trx, revision.branch_id);
    if (branchResult === undefined || branchResult === null || typeof branchResult !== 'object') {
      throw new ArtifactBusinessError(
        ARTIFACT_WORKBOOK_BASE_INVALID,
        'base Revision Branch is not authoritative',
      );
    }
    const branch = branchResult as ExactRevisionFacts['branch'];
    if (branch.artifact_id !== root.artifact_id || branch.project_id !== root.project_id) {
      throw new ArtifactBusinessError(
        ARTIFACT_WORKBOOK_BASE_INVALID,
        'base Revision Branch is not authoritative',
      );
    }
    const workingHeadRef: unknown = branch.working_head_ref;
    if (requireCurrentHead) {
      if (workingHeadRef == null) {
        throw new ArtifactBusinessError(
          ARTIFACT_WORKBOOK_BASE_STALE,
          'Human Edit requires the exact current Branch head',
        );
      }
      const head = storedJson(workingHeadRef, 'workingHeadRef');
      if (canonicalize(head) !== canonicalize(ref as unknown as CanonicalJsonValue)) {
        throw new ArtifactBusinessError(
          ARTIFACT_WORKBOOK_BASE_STALE,
          'Human Edit base Revision is stale relative to the Branch head',
        );
      }
    }
    const contentObjectResult: unknown = await repo.getContentObjectById(
      trx,
      revision.content_object_id,
    );
    if (
      contentObjectResult === undefined ||
      contentObjectResult === null ||
      typeof contentObjectResult !== 'object'
    ) {
      throw new ArtifactBusinessError(
        ARTIFACT_WORKBOOK_BASE_INVALID,
        'base Revision does not point to an exact FROZEN WorkbookSpec object',
      );
    }
    const contentObject = contentObjectResult as ArtifactContentObjectTable;
    if (
      contentObject.storage_state !== 'FROZEN' ||
      contentObject.enterprise_id !== root.enterprise_id ||
      contentObject.project_id !== root.project_id ||
      contentObject.content_type !== 'WORKBOOK_SPEC' ||
      contentObject.object_locator !== revision.object_locator ||
      !contentObject.content_hash.equals(revision.content_hash) ||
      contentObject.canonicalization_version !== '1' ||
      contentObject.media_type !== CANONICAL_MEDIA_TYPE
    ) {
      throw new ArtifactBusinessError(
        ARTIFACT_WORKBOOK_BASE_INVALID,
        'base Revision does not point to an exact FROZEN WorkbookSpec object',
      );
    }
    const schemaRef = normalizeSchemaRef(
      storedJson(revision.structure_schema_ref, 'structureSchemaRef'),
      context,
      root.project_id ?? undefined,
    );
    const manifestSchemaRef = normalizeSchemaRef(
      storedJson(contentObject.payload_schema_ref, 'payloadSchemaRef'),
      context,
      root.project_id ?? undefined,
    );
    if (
      canonicalize(schemaRef as unknown as CanonicalJsonValue) !==
      canonicalize(manifestSchemaRef as unknown as CanonicalJsonValue)
    ) {
      throw new ArtifactBusinessError(
        ARTIFACT_WORKBOOK_BASE_INVALID,
        'base Revision SchemaRef does not match the FROZEN Content Object',
      );
    }
    const governance = await repo.getRevisionGovernance(trx, revision.revision_id);
    return {
      ref,
      revision,
      root,
      branch,
      contentObject,
      schemaRef,
      disposition: revisionDisposition(governance),
    };
  });
}

function storageReference(row: ArtifactContentObjectTable): {
  readonly storageProvider: string;
  readonly objectLocator: string;
  readonly objectVersionId: string;
} {
  return {
    storageProvider: row.storage_provider,
    objectLocator: row.object_locator,
    objectVersionId: row.object_version_id,
  };
}

function assertReadbackMetadata(readback: ObjectStorageReadback, facts: ExactRevisionFacts): void {
  if (
    readback.storageProvider !== facts.contentObject.storage_provider ||
    readback.objectLocator !== facts.contentObject.object_locator ||
    readback.objectVersionId !== facts.contentObject.object_version_id ||
    readback.mediaType !== facts.contentObject.media_type ||
    !Number.isSafeInteger(readback.byteSize) ||
    readback.byteSize < 0 ||
    readback.byteSize !== readback.bytes.byteLength
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_READBACK_MISMATCH,
      'authoritative WorkbookSpec readback metadata is not acceptable',
    );
  }
}

async function readWorkbook(
  storage: ObjectStoragePort,
  context: ArtifactTransactionContext,
  facts: ExactRevisionFacts,
  options: WorkbookValidationOptions,
): Promise<WorkbookRead> {
  let readback: ObjectStorageReadback;
  try {
    readback = await storage.read(storageReference(facts.contentObject));
  } catch {
    throw new ArtifactBusinessError(
      ARTIFACT_WORKBOOK_BASE_INVALID,
      'authoritative WorkbookSpec object is unavailable',
    );
  }
  assertReadbackMetadata(readback, facts);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readback.bytes.toString('utf8')) as unknown;
  } catch {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_READBACK_MISMATCH,
      'authoritative WorkbookSpec object is not valid JSON',
    );
  }
  const validation = registry.validateCanonicalContent(parsed);
  if (!validation.valid) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_READBACK_MISMATCH,
      'authoritative WorkbookSpec object failed executable validation',
    );
  }
  const payload = parsed as Artifact.CanonicalWorkbookContent;
  const payloadSchemaRef = normalizeSchemaRef(
    payload.schemaRef,
    context,
    facts.root.project_id ?? undefined,
  );
  if (
    canonicalize(payloadSchemaRef as unknown as CanonicalJsonValue) !==
    canonicalize(facts.schemaRef as unknown as CanonicalJsonValue)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_READBACK_MISMATCH,
      'authoritative WorkbookSpec SchemaRef does not match the Revision',
    );
  }
  const hashablePayload = payload as unknown as SharedCanonicalContentPayload;
  const canonicalBytes = Buffer.from(canonicalizeCanonicalContentPayload(hashablePayload), 'utf8');
  const calculatedHash = hashCanonicalContentPayload(hashablePayload);
  if (
    !readback.bytes.equals(canonicalBytes) ||
    !facts.revision.content_hash.equals(Buffer.from(calculatedHash.digest, 'hex')) ||
    !facts.contentObject.content_hash.equals(Buffer.from(calculatedHash.digest, 'hex'))
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_READBACK_MISMATCH,
      'authoritative WorkbookSpec bytes do not match the immutable Revision Hash',
    );
  }
  const normalized = canonicalizeWorkbookSpec(
    payload.body,
    facts.schemaRef,
    context,
    facts.root.project_id ?? undefined,
    options,
  );
  return {
    workbook: normalized.payload.body,
    canonicalBytes,
    contentHash: calculatedHash,
  };
}

async function readContentObject(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  contentObjectId: string,
): Promise<ArtifactContentObjectTable> {
  return withArtifactTransaction(db, context, async (trx) => {
    const row = await repo.getContentObjectById(trx, contentObjectId);
    if (row === undefined) {
      throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'content object is not visible');
    }
    return row;
  });
}

function derivedUuidV7(seed: string, label: string): string {
  const hex = createHash('sha256')
    .update(`${seed}:${label}`, 'utf8')
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '7';
  hex[16] = '8';
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function stepEnvelope<TPayload>(
  outer: WorkbookEditCommandEnvelope,
  step: string,
  commandType: string,
  payload: TPayload,
  targetType: string,
  targetId: string,
  projectId: string | undefined,
): CommandEnvelope & { readonly payload: TPayload } {
  return {
    commandId: derivedUuidV7(outer.commandId, step),
    commandType,
    commandVersion: '1.0',
    idempotencyScope: outer.idempotencyScope,
    idempotencyKey: `${outer.idempotencyKey}:${step}`,
    requestPayload: payload as unknown as CanonicalJsonObject,
    enterpriseId: outer.enterpriseId,
    ...(projectId === undefined ? {} : { projectId }),
    targetType,
    targetId,
    correlationId: outer.correlationId,
    causationId: outer.commandId,
    principalId: outer.principalId,
    principalKind: outer.principalKind,
    actorSnapshotId: outer.actorSnapshotId,
    authorizationDecisionId: outer.authorizationDecisionId,
    policySnapshotId: outer.policySnapshotId,
    payload,
  };
}

function assertCommandCommitted(result: CommandResult, operation: string): CanonicalJsonObject {
  if (result.status === 'COMMITTED') return result.resultPayload;
  if (result.status === 'DUPLICATE' && result.originalOutcome === 'COMMITTED') {
    if (result.resultPayload === null) {
      throw new ArtifactBusinessError(
        ARTIFACT_CONTENT_STATE_INVALID,
        `${operation} replay did not contain a committed result`,
      );
    }
    return result.resultPayload;
  }
  if (result.status === 'REJECTED') {
    throw new ArtifactBusinessError(result.errorCode, result.safeSummary);
  }
  throw new ArtifactBusinessError(ARTIFACT_CONTENT_STATE_INVALID, `${operation} did not commit`);
}

function assertTargetArtifact(envelope: WorkbookEditCommandEnvelope): void {
  if (!ROOT_OBJECT_TYPES.has(envelope.targetType) || !isUuidV7(envelope.targetId)) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      'Workbook Human Edit target must be an Artifact UUIDv7',
    );
  }
}

function stableAllowedRef(value: unknown): WorkbookAllowedRef {
  const ref = record(value);
  const nonEmptyId = (candidate: unknown, label: string): string => {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
      throw new ArtifactBusinessError(ARTIFACT_WORKBOOK_EDIT_SCOPE, `${label} must be non-empty`);
    }
    return candidate;
  };
  if (ref.kind === 'SHEET') {
    assertClosedKeys(
      ref,
      new Set(['kind', 'sheetId']),
      'Workbook allowed SHEET ref',
      ARTIFACT_WORKBOOK_EDIT_SCOPE,
    );
    return { kind: 'SHEET', sheetId: nonEmptyId(ref.sheetId, 'sheetId') };
  }
  if (ref.kind === 'ROW') {
    assertClosedKeys(
      ref,
      new Set(['kind', 'sheetId', 'rowId']),
      'Workbook allowed ROW ref',
      ARTIFACT_WORKBOOK_EDIT_SCOPE,
    );
    return {
      kind: 'ROW',
      sheetId: nonEmptyId(ref.sheetId, 'sheetId'),
      rowId: nonEmptyId(ref.rowId, 'rowId'),
    };
  }
  if (ref.kind === 'CELL') {
    assertClosedKeys(
      ref,
      new Set(['kind', 'sheetId', 'rowId', 'cellId']),
      'Workbook allowed CELL ref',
      ARTIFACT_WORKBOOK_EDIT_SCOPE,
    );
    return {
      kind: 'CELL',
      sheetId: nonEmptyId(ref.sheetId, 'sheetId'),
      rowId: nonEmptyId(ref.rowId, 'rowId'),
      cellId: nonEmptyId(ref.cellId, 'cellId'),
    };
  }
  throw new ArtifactBusinessError(
    ARTIFACT_WORKBOOK_EDIT_SCOPE,
    'Workbook allowed ref must be a SHEET, ROW, or CELL stable ref',
  );
}

function validatedEditPayload(payload: unknown): WorkbookEditPayload {
  const value = record(payload);
  assertClosedKeys(
    value,
    new Set(['baseRevisionRef', 'allowedRefs', 'workbook', 'changeSummary']),
    'Workbook Human Edit payload',
    ARTIFACT_WORKBOOK_EDIT_SCOPE,
  );
  if (
    !Array.isArray(value.allowedRefs) ||
    value.allowedRefs.length === 0 ||
    typeof value.changeSummary !== 'string' ||
    value.changeSummary.trim().length === 0 ||
    value.workbook === null ||
    typeof value.workbook !== 'object' ||
    Array.isArray(value.workbook)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_WORKBOOK_EDIT_SCOPE,
      'Workbook Human Edit payload is incomplete',
    );
  }
  const allowedRefs = value.allowedRefs.map(stableAllowedRef);
  const uniqueAllowedRefs = new Set(
    allowedRefs.map((ref) => canonicalize(ref as unknown as CanonicalJsonValue)),
  );
  if (uniqueAllowedRefs.size !== allowedRefs.length) {
    throw new ArtifactBusinessError(
      ARTIFACT_WORKBOOK_EDIT_SCOPE,
      'Workbook Human Edit allowedRefs contains a duplicate stable ref',
    );
  }
  return {
    baseRevisionRef: value.baseRevisionRef as Common.ContentAddressedRef,
    allowedRefs,
    workbook: value.workbook as Artifact.CanonicalWorkbookSpec,
    changeSummary: value.changeSummary,
  };
}

function baseProvenanceForEdit(
  value: unknown,
  context: ArtifactTransactionContext,
): Artifact.RevisionProvenance {
  const stored = record(value);
  const sourceMaterialRefs = Array.isArray(stored.sourceMaterialRefs)
    ? stored.sourceMaterialRefs
    : [];
  const toolchainVersions = Array.isArray(stored.toolchainVersions) ? stored.toolchainVersions : [];
  const principal: Common.ObjectRef = {
    kind: 'OBJECT',
    objectType: 'identity.principal',
    objectId: context.principalId,
    scope: { enterpriseId: context.enterpriseId },
  };
  return canonicalJsonClone({
    ...stored,
    principal,
    sourceMaterialRefs,
    toolchainVersions,
  });
}

function workbookMetadataFingerprint(workbook: Artifact.CanonicalWorkbookSpec): string {
  return canonicalize({
    workbookId: workbook.workbookId,
    metadata: workbook.metadata ?? null,
  });
}

function existingStablePaths(workbook: Artifact.CanonicalWorkbookSpec): ReadonlySet<string> {
  return new Set(indexWorkbook(workbook).keys());
}

function allowedRefPath(ref: WorkbookAllowedRef): string {
  if (ref.kind === 'SHEET') return `sheet/${ref.sheetId}`;
  if (ref.kind === 'ROW') return `sheet/${ref.sheetId}/row/${ref.rowId}`;
  return `sheet/${ref.sheetId}/row/${ref.rowId}/cell/${ref.cellId}`;
}

export function validateWorkbookEditCandidate(
  base: Artifact.CanonicalWorkbookSpec,
  candidate: Artifact.CanonicalWorkbookSpec,
  allowedRefs: readonly WorkbookAllowedRef[],
  options: WorkbookValidationOptions = {},
): WorkbookDiff {
  const normalizedBase = validateWorkbookSpec(base, options);
  const normalizedCandidate = validateWorkbookSpec(candidate, options);
  const diff = diffWorkbookSpecs(normalizedBase, normalizedCandidate, options);
  const knownPaths = new Set([
    ...existingStablePaths(normalizedBase),
    ...existingStablePaths(normalizedCandidate),
  ]);
  for (const ref of allowedRefs) {
    if (!knownPaths.has(allowedRefPath(ref))) {
      throw new ArtifactBusinessError(
        ARTIFACT_WORKBOOK_EDIT_SCOPE,
        'Workbook Human Edit allowedRefs contains an unknown stable ref',
      );
    }
  }
  if (diff.workbookChanged) {
    throw new ArtifactBusinessError(
      ARTIFACT_WORKBOOK_EDIT_SCOPE,
      'Workbook Human Edit cannot change workbookId or Workbook metadata',
    );
  }
  const allowedPaths = allowedRefs.map(allowedRefPath);
  for (const entry of diff.entries) {
    if (entry.entityType === 'COLUMN') {
      throw new ArtifactBusinessError(
        ARTIFACT_WORKBOOK_EDIT_SCOPE,
        'Workbook Human Edit cannot change Column definitions',
      );
    }
    const covered = allowedPaths.some((allowedPath) => {
      if (entry.entityType === 'SHEET') return allowedPath === entry.stablePath;
      if (entry.entityType === 'ROW') {
        return (
          allowedPath === entry.stablePath ||
          allowedPath === `sheet/${entry.to?.sheetId ?? entry.from?.sheetId ?? ''}`
        );
      }
      if (entry.entityType === 'CELL') {
        const sheetId = entry.to?.sheetId ?? entry.from?.sheetId ?? '';
        const rowId = entry.to?.rowId ?? entry.from?.rowId ?? '';
        return (
          allowedPath === entry.stablePath ||
          allowedPath === `sheet/${sheetId}/row/${rowId}` ||
          allowedPath === `sheet/${sheetId}`
        );
      }
      return false;
    });
    if (!covered) {
      throw new ArtifactBusinessError(
        ARTIFACT_WORKBOOK_EDIT_SCOPE,
        'Workbook Human Edit contains a change outside allowedRefs',
      );
    }
  }
  return diff;
}

export async function handleHumanWorkbookEdit(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: WorkbookEditCommandEnvelope,
  storage: ObjectStoragePort,
  options: WorkbookValidationOptions = {},
): Promise<WorkbookEditResult> {
  if (context.principalKind !== 'HUMAN' || envelope.principalKind !== 'HUMAN') {
    throw new ArtifactBusinessError(
      ARTIFACT_HUMAN_ONLY_DENIED,
      'Workbook Human Edit requires a HUMAN principal',
    );
  }
  assertEnvelopeMatchesContext(context, envelope);
  assertTargetArtifact(envelope);
  const payload = validatedEditPayload(envelope.payload);
  const facts = await readExactRevisionFacts(db, context, payload.baseRevisionRef, true);
  if (facts.root.artifact_id !== envelope.targetId) {
    throw new ArtifactBusinessError(
      ARTIFACT_WORKBOOK_BASE_INVALID,
      'Human Edit target Artifact does not match the exact base Revision',
    );
  }
  if (facts.disposition !== 'ACTIVE') {
    throw new ArtifactBusinessError(
      ARTIFACT_WORKBOOK_BASE_INVALID,
      'Human Edit base Revision is not active',
    );
  }
  const base = await readWorkbook(storage, context, facts, options);
  const candidate = canonicalizeWorkbookSpec(
    payload.workbook,
    facts.schemaRef,
    context,
    facts.root.project_id ?? undefined,
    options,
  );
  if (candidate.payload.body.workbookId !== base.workbook.workbookId) {
    throw new ArtifactBusinessError(
      ARTIFACT_WORKBOOK_ID_MISMATCH,
      'Human Edit cannot change the Workbook workbookId',
    );
  }
  if (
    workbookMetadataFingerprint(candidate.payload.body) !==
    workbookMetadataFingerprint(base.workbook)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_WORKBOOK_EDIT_SCOPE,
      'Human Edit cannot change Workbook metadata',
    );
  }
  const diff = validateWorkbookEditCandidate(
    base.workbook,
    candidate.payload.body,
    payload.allowedRefs,
    options,
  );
  if (diff.entries.length === 0) {
    throw new ArtifactBusinessError(
      ARTIFACT_WORKBOOK_NOOP,
      'Human Edit does not change the canonical WorkbookSpec',
    );
  }

  const contentObjectId = derivedUuidV7(envelope.commandId, 'content-object');
  const revisionId = derivedUuidV7(envelope.commandId, 'revision');
  const projectId = facts.root.project_id ?? undefined;
  const stagePayload: StageCanonicalContentPayload = {
    content: candidate.payload,
    declaredContentHash: candidate.contentHash,
  };
  const stageEnvelope = stepEnvelope(
    envelope,
    'stage',
    'artifact.workbook.human_edit.stage',
    stagePayload,
    CANONICAL_OBJECT_TYPE,
    contentObjectId,
    projectId,
  ) as CanonicalContentCommandEnvelope<StageCanonicalContentPayload>;
  assertCommandCommitted(
    await stageCanonicalContent(db, context, stageEnvelope, storage),
    'Workbook stage',
  );

  const linkPayload: LinkCanonicalContentPayload = {
    ownerObjectType: REVISION_OBJECT_TYPE,
    ownerObjectId: revisionId,
    ownerVersionId: revisionId,
    ownerPayloadHash: candidate.contentHash,
  };
  const linkEnvelope = stepEnvelope(
    envelope,
    'link',
    'artifact.workbook.human_edit.link',
    linkPayload,
    CANONICAL_OBJECT_TYPE,
    contentObjectId,
    projectId,
  ) as CanonicalContentCommandEnvelope<LinkCanonicalContentPayload>;
  const linked = await linkCanonicalContent(db, context, linkEnvelope, storage);
  assertCommandCommitted(linked.commandResult, 'Workbook link');
  if (linked.finalizationState === 'UNKNOWN') {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_FINALIZATION_UNKNOWN,
      'Workbook Content Object finalization is unknown and remains retryable',
    );
  }
  const linkedRow = await readContentObject(db, context, contentObjectId);
  if (linkedRow.storage_state === 'LINKED') {
    const freezeEnvelope = stepEnvelope(
      envelope,
      'freeze',
      'artifact.workbook.human_edit.freeze',
      { contentObjectId },
      CANONICAL_OBJECT_TYPE,
      contentObjectId,
      projectId,
    );
    assertCommandCommitted(
      await freezeCanonicalContent(db, context, freezeEnvelope),
      'Workbook freeze',
    );
  }
  const frozenRow = await readContentObject(db, context, contentObjectId);
  if (frozenRow.storage_state !== 'FROZEN') {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_STATE_INVALID,
      'Workbook Content Object was not frozen before Revision creation',
    );
  }

  const changedUnits = [...new Set(diff.entries.map((entry) => entry.stablePath))].sort(
    compareUtf8,
  );
  const revision: Artifact.RevisionContent = {
    artifactRef: artifactRefForRoot(facts.root),
    branchId: facts.revision.branch_id,
    parentRevisionRefs: [facts.ref],
    contentType: 'WORKBOOK_SPEC',
    contentRef: frozenRow.object_locator,
    contentHash: candidate.contentHash,
    structureSchemaRef: facts.schemaRef,
    semanticMetadata: storedJson(facts.revision.semantic_metadata, 'semanticMetadata'),
    changedUnits,
    changeSummary: payload.changeSummary,
    provenance: baseProvenanceForEdit(facts.revision.provenance, context),
  };
  const createPayload: CreateAndSealRevisionPayload = { revision };
  const createEnvelope = stepEnvelope(
    envelope,
    'revision',
    'artifact.workbook.human_edit.create_revision',
    createPayload,
    REVISION_OBJECT_TYPE,
    revisionId,
    projectId,
  ) as RevisionCommandEnvelope<CreateAndSealRevisionPayload>;
  assertCommandCommitted(
    await handleCreateAndSealRevision(db, context, createEnvelope),
    'Workbook Revision creation',
  );
  const newRevisionRef: Common.ContentAddressedRef = {
    kind: 'CONTENT_ADDRESSED',
    objectType: REVISION_OBJECT_TYPE,
    objectId: revisionId,
    scope: rootScope(facts.root),
    contentHash: candidate.contentHash,
  };
  const snapshot = await handleGetRevisionSnapshot(db, context, { revisionRef: newRevisionRef });
  return {
    baseRevisionRef: facts.ref,
    revision: snapshot,
    contentObjectId,
    contentRef: frozenRow.object_locator,
    canonicalBytes: candidate.canonicalBytes.toString('utf8'),
    contentHash: candidate.contentHash,
    diff,
  };
}

export async function handleGetWorkbookDiff(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  payload: GetRevisionDiffInputsPayload,
  storage: ObjectStoragePort,
  options: WorkbookValidationOptions = {},
): Promise<WorkbookDiffResult> {
  const inputs = await handleGetRevisionDiffInputs(db, context, payload);
  if (inputs.left.contentType !== 'WORKBOOK_SPEC' || inputs.right.contentType !== 'WORKBOOK_SPEC') {
    throw new ArtifactBusinessError(
      ARTIFACT_WORKBOOK_SCHEMA_INVALID,
      'Workbook Diff requires two WorkbookSpec Revisions',
    );
  }
  const leftFacts = await readExactRevisionFacts(
    db,
    context,
    inputs.left.revisionRef,
    false,
    false,
  );
  const rightFacts = await readExactRevisionFacts(
    db,
    context,
    inputs.right.revisionRef,
    false,
    false,
  );
  if (
    canonicalize(leftFacts.schemaRef as unknown as CanonicalJsonValue) !==
    canonicalize(rightFacts.schemaRef as unknown as CanonicalJsonValue)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_WORKBOOK_SCHEMA_INVALID,
      'Workbook Diff requires matching structure SchemaRefs',
    );
  }
  const left = await readWorkbook(storage, context, leftFacts, options);
  const right = await readWorkbook(storage, context, rightFacts, options);
  return {
    inputs,
    diff: diffWorkbookSpecs(left.workbook, right.workbook, options),
    leftCanonicalBytes: left.canonicalBytes.toString('utf8'),
    rightCanonicalBytes: right.canonicalBytes.toString('utf8'),
  };
}
