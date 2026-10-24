import { createHash } from 'node:crypto';

import { MEDIA_TYPES } from '../domain/policy.js';
import type { EntryStatus, ReasonCode } from '../domain/types.js';
import { scanXml, qualified, type XmlTag } from './xml.js';
import { ZipSafetyError, parseZipContainer, type ScanBudget, type ZipEntry } from './zip.js';

export interface ClassifiedEntry {
  readonly status: EntryStatus;
  readonly reasonCodes: readonly ReasonCode[];
  readonly mediaType?: string;
}

const CONTENT_TYPES_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/content-types';
const RELATIONSHIPS_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const RELATIONSHIP_NAMESPACES = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
] as const;
const WORD_NAMESPACES = [
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
] as const;
const SPREADSHEET_NAMESPACES = [
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  'http://purl.oclc.org/ooxml/spreadsheetml/main',
] as const;
const OFFICE_DOCUMENT_TYPES = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument',
] as const;
const WORKSHEET_TYPES = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/worksheet',
] as const;
const SPREADSHEET_WORKBOOK_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const WORD_MAIN_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

const ACTIVE_PATH =
  /(?:^|\/)(?:vbaProject(?:Project)?\.bin|activeX|embeddings|oleObject[^/]*)(?:\/|$)|\.bin$/iu;
const ACTIVE_CONTENT_TYPE = /macroenabled|vbaproject|activex|oleobject/iu;

function classify(status: EntryStatus, reasonCodes: readonly ReasonCode[]): ClassifiedEntry {
  return { status, reasonCodes };
}

function corruptFormat(reason: 'INVALID_DOCX' | 'INVALID_XLSX'): ClassifiedEntry {
  return classify('CORRUPT', [reason]);
}

function isLimit(error: unknown): boolean {
  return error instanceof ZipSafetyError && error.code === 'ZIP_LIMIT_EXCEEDED';
}

function guardLimit(error: unknown): never {
  if (isLimit(error)) throw error;
  throw error;
}

function nestedContainer(bytes: Buffer, budget: ScanBudget): ZipEntry[] | undefined {
  try {
    return parseZipContainer(bytes, budget);
  } catch (error) {
    if (isLimit(error)) guardLimit(error);
    return undefined;
  }
}

function byPath(entries: readonly ZipEntry[]): Map<string, ZipEntry> {
  return new Map(entries.map((entry) => [entry.normalizedPath, entry]));
}

interface ContentTypes {
  readonly overrides: ReadonlyMap<string, string>;
  readonly defaults: ReadonlyMap<string, string>;
}

function parseContentTypes(bytes: Buffer, budget: ScanBudget): ContentTypes | undefined {
  const overrides = new Map<string, string>();
  const defaults = new Map<string, string>();
  let duplicate = false;
  try {
    scanXml(
      bytes,
      budget,
      { roots: [{ local: 'Types', namespaces: [CONTENT_TYPES_NAMESPACE] }] },
      (tag) => {
        if (tag.depth !== 1 || tag.uri !== CONTENT_TYPES_NAMESPACE) return;
        if (tag.local === 'Default') {
          const extension = qualified(tag, 'Extension')?.toLowerCase();
          const type = qualified(tag, 'ContentType');
          if (extension === undefined || type === undefined) return;
          if (defaults.has(extension)) duplicate = true;
          defaults.set(extension, type);
          return;
        }
        if (tag.local !== 'Override') return;
        const part = qualified(tag, 'PartName');
        const type = qualified(tag, 'ContentType');
        if (part === undefined || type === undefined) return;
        if (overrides.has(part)) duplicate = true;
        overrides.set(part, type);
      },
    );
  } catch (error) {
    if (isLimit(error)) guardLimit(error);
    return undefined;
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the flag is set from the parser callback.
  if (duplicate) return undefined;
  return { overrides, defaults };
}

interface Relationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
}

function parseRelationships(
  bytes: Buffer,
  budget: ScanBudget,
): { relationships: Relationship[]; external: boolean } | undefined {
  const relationships: Relationship[] = [];
  const seen = new Set<string>();
  let invalid = false;
  try {
    scanXml(
      bytes,
      budget,
      { roots: [{ local: 'Relationships', namespaces: [RELATIONSHIPS_NAMESPACE] }] },
      (tag) => {
        if (tag.depth !== 1 || tag.local !== 'Relationship') return;
        const id = qualified(tag, 'Id');
        const type = qualified(tag, 'Type');
        const target = qualified(tag, 'Target');
        const targetMode = qualified(tag, 'TargetMode');
        if (id === undefined || type === undefined || target === undefined) {
          invalid = true;
          return;
        }
        if (seen.has(id)) invalid = true;
        seen.add(id);
        relationships.push({
          id,
          type,
          target,
          external: targetMode !== undefined && targetMode !== 'Internal',
        });
      },
    );
  } catch (error) {
    if (isLimit(error)) guardLimit(error);
    return undefined;
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the flag is set from the parser callback.
  if (invalid) return undefined;
  return { relationships, external: relationships.some((item) => item.external) };
}

/** Resolve an OPC part target relative to the part owning the relationship. */
export function resolvePartTarget(baseDirectory: string, target: string): string | undefined {
  // eslint-disable-next-line no-control-regex -- OPC targets must reject control characters.
  if (target.length === 0 || /[\x00-\x1f\x7f\\]/u.test(target) || target.includes('%'))
    return undefined;
  const segments = target.startsWith('/')
    ? target.slice(1).split('/')
    : `${baseDirectory}/${target}`.split('/');
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (resolved.length === 0) return undefined;
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.length === 0 ? undefined : resolved.join('/');
}

function directoryOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

interface RelationshipScan {
  readonly external: boolean;
  readonly valid: boolean;
}

function scanAllRelationships(entries: readonly ZipEntry[], budget: ScanBudget): RelationshipScan {
  let external = false;
  for (const entry of entries) {
    if (!entry.normalizedPath.endsWith('.rels')) continue;
    const parsed = parseRelationships(entry.bytes, budget);
    if (parsed === undefined) return { external, valid: false };
    if (parsed.external) external = true;
  }
  return { external, valid: true };
}

function hasActiveContent(
  entries: readonly ZipEntry[],
  contentTypes: ContentTypes | undefined,
): boolean {
  if (entries.some((entry) => ACTIVE_PATH.test(entry.normalizedPath))) return true;
  if (contentTypes === undefined) return false;
  for (const type of [...contentTypes.overrides.values(), ...contentTypes.defaults.values()])
    if (ACTIVE_CONTENT_TYPE.test(type)) return true;
  return false;
}

function relationshipId(tag: XmlTag): string | undefined {
  const attribute = tag.attributes['r:id'];
  if (
    attribute === undefined ||
    !(RELATIONSHIP_NAMESPACES as readonly string[]).includes(attribute.uri)
  )
    return undefined;
  return attribute.value;
}

function docx(entries: readonly ZipEntry[], budget: ScanBudget): ClassifiedEntry {
  const names = byPath(entries);
  const contentTypesEntry = names.get('[Content_Types].xml');
  const rootRelsEntry = names.get('_rels/.rels');
  const documentEntry = names.get('word/document.xml');
  if (contentTypesEntry === undefined || rootRelsEntry === undefined || documentEntry === undefined)
    return corruptFormat('INVALID_DOCX');
  const contentTypes = parseContentTypes(contentTypesEntry.bytes, budget);
  if (contentTypes === undefined) return corruptFormat('INVALID_DOCX');
  if (hasActiveContent(entries, contentTypes))
    return classify('UNSUPPORTED', ['ACTIVE_CONTENT_NOT_SUPPORTED']);
  const rootRels = parseRelationships(rootRelsEntry.bytes, budget);
  if (rootRels === undefined) return corruptFormat('INVALID_DOCX');
  const officeDocument = rootRels.relationships.filter((item) =>
    (OFFICE_DOCUMENT_TYPES as readonly string[]).includes(item.type),
  );
  const mainRelationship = officeDocument[0];
  if (
    officeDocument.length !== 1 ||
    mainRelationship === undefined ||
    mainRelationship.external ||
    !['word/document.xml', '/word/document.xml'].includes(mainRelationship.target) ||
    contentTypes.overrides.get('/word/document.xml') !== WORD_MAIN_TYPE
  )
    return corruptFormat('INVALID_DOCX');
  try {
    scanXml(
      documentEntry.bytes,
      budget,
      { roots: [{ local: 'document', namespaces: WORD_NAMESPACES }] },
      () => undefined,
    );
  } catch (error) {
    if (isLimit(error)) guardLimit(error);
    return corruptFormat('INVALID_DOCX');
  }
  const relationships = scanAllRelationships(entries, budget);
  if (!relationships.valid) return corruptFormat('INVALID_DOCX');
  if (relationships.external)
    return classify('READ_LIMITED', ['EXTERNAL_REFERENCE_REQUIRES_REVIEW']);
  return { status: 'ACCEPTED', reasonCodes: [], mediaType: MEDIA_TYPES.docx };
}

function validateSpreadsheetPart(entry: ZipEntry, budget: ScanBudget, root: string): boolean {
  try {
    scanXml(
      entry.bytes,
      budget,
      { roots: [{ local: root, namespaces: SPREADSHEET_NAMESPACES }] },
      () => undefined,
    );
    return true;
  } catch (error) {
    if (isLimit(error)) guardLimit(error);
    return false;
  }
}

function xlsx(entries: readonly ZipEntry[], budget: ScanBudget): ClassifiedEntry {
  const names = byPath(entries);
  const contentTypesEntry = names.get('[Content_Types].xml');
  const rootRelsEntry = names.get('_rels/.rels');
  if (contentTypesEntry === undefined || rootRelsEntry === undefined)
    return corruptFormat('INVALID_XLSX');
  const contentTypes = parseContentTypes(contentTypesEntry.bytes, budget);
  if (contentTypes === undefined) return corruptFormat('INVALID_XLSX');
  if (hasActiveContent(entries, contentTypes))
    return classify('UNSUPPORTED', ['ACTIVE_CONTENT_NOT_SUPPORTED']);
  const workbookParts = [...contentTypes.overrides.entries()].filter(
    ([, type]) => type === SPREADSHEET_WORKBOOK_TYPE,
  );
  const workbookPart = workbookParts[0];
  if (workbookParts.length !== 1 || workbookPart === undefined)
    return corruptFormat('INVALID_XLSX');
  const workbookPath = workbookPart[0].replace(/^\//u, '');
  const workbookEntry = names.get(workbookPath);
  if (workbookEntry === undefined) return corruptFormat('INVALID_XLSX');
  const rootRels = parseRelationships(rootRelsEntry.bytes, budget);
  if (rootRels === undefined) return corruptFormat('INVALID_XLSX');
  const officeDocument = rootRels.relationships.filter((item) =>
    (OFFICE_DOCUMENT_TYPES as readonly string[]).includes(item.type),
  );
  const mainRelationship = officeDocument[0];
  if (
    officeDocument.length !== 1 ||
    mainRelationship === undefined ||
    mainRelationship.external ||
    resolvePartTarget('', mainRelationship.target) !== workbookPath
  )
    return corruptFormat('INVALID_XLSX');

  const workbookDirectory = directoryOf(workbookPath);
  const workbookFile = workbookPath.split('/').pop() ?? '';
  const relationshipsPath = `${workbookDirectory}/_rels/${workbookFile}.rels`;
  const relationshipsEntry = names.get(relationshipsPath);
  if (relationshipsEntry === undefined) return corruptFormat('INVALID_XLSX');
  const relationships = parseRelationships(relationshipsEntry.bytes, budget);
  if (relationships === undefined) return corruptFormat('INVALID_XLSX');
  const byId = new Map(relationships.relationships.map((item) => [item.id, item]));
  if (byId.size !== relationships.relationships.length) return corruptFormat('INVALID_XLSX');

  const sheets: string[] = [];
  try {
    scanXml(
      workbookEntry.bytes,
      budget,
      { roots: [{ local: 'workbook', namespaces: SPREADSHEET_NAMESPACES }] },
      (tag) => {
        if (tag.local !== 'sheet') return;
        const id = relationshipId(tag);
        if (id === undefined) throw new ZipSafetyError('ZIP_CORRUPT');
        sheets.push(id);
      },
    );
  } catch (error) {
    if (isLimit(error)) guardLimit(error);
    return corruptFormat('INVALID_XLSX');
  }
  if (sheets.length === 0) return corruptFormat('INVALID_XLSX');
  const targets = new Set<string>();
  for (const sheet of sheets) {
    const relationship = byId.get(sheet);
    if (
      relationship === undefined ||
      relationship.external ||
      !(WORKSHEET_TYPES as readonly string[]).includes(relationship.type)
    )
      return corruptFormat('INVALID_XLSX');
    const target = resolvePartTarget(workbookDirectory, relationship.target);
    if (target === undefined) return corruptFormat('INVALID_XLSX');
    const worksheet = names.get(target);
    if (worksheet === undefined || targets.has(target)) return corruptFormat('INVALID_XLSX');
    targets.add(target);
    if (!validateSpreadsheetPart(worksheet, budget, 'worksheet'))
      return corruptFormat('INVALID_XLSX');
  }
  for (const optional of [
    { kind: 'styles', root: 'styleSheet' },
    { kind: 'sharedStrings', root: 'sst' },
  ]) {
    const referenced = relationships.relationships.filter((relationship) =>
      RELATIONSHIP_NAMESPACES.some(
        (namespace) => relationship.type === `${namespace}/${optional.kind}`,
      ),
    );
    if (referenced.length > 1) return corruptFormat('INVALID_XLSX');
    const validated = new Set<string>();
    for (const relationship of referenced) {
      // External references are classified below without accessing their targets.
      if (relationship.external) continue;
      const target = resolvePartTarget(workbookDirectory, relationship.target);
      if (target === undefined) return corruptFormat('INVALID_XLSX');
      const entry = names.get(target);
      const extension = target.split('.').at(-1)?.toLowerCase() ?? '';
      const mediaType =
        contentTypes.overrides.get(`/${target}`) ?? contentTypes.defaults.get(extension);
      if (
        entry === undefined ||
        mediaType !==
          `application/vnd.openxmlformats-officedocument.spreadsheetml.${optional.kind}+xml` ||
        !validateSpreadsheetPart(entry, budget, optional.root)
      )
        return corruptFormat('INVALID_XLSX');
      validated.add(target);
    }
    // Preserve existing safety checks for conventional parts even if unreferenced.
    const conventionalPath = `${workbookDirectory}/${optional.kind}.xml`;
    const conventionalEntry = names.get(conventionalPath);
    if (
      conventionalEntry !== undefined &&
      !validated.has(conventionalPath) &&
      !validateSpreadsheetPart(conventionalEntry, budget, optional.root)
    )
      return corruptFormat('INVALID_XLSX');
  }
  const allRelationships = scanAllRelationships(entries, budget);
  if (!allRelationships.valid) return corruptFormat('INVALID_XLSX');
  if (allRelationships.external)
    return classify('READ_LIMITED', ['EXTERNAL_REFERENCE_REQUIRES_REVIEW']);
  return { status: 'ACCEPTED', reasonCodes: [], mediaType: MEDIA_TYPES.xlsx };
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function classifyEntry(
  originalName: string,
  bytes: Buffer,
  budget: ScanBudget,
): ClassifiedEntry {
  if (/\.md$/iu.test(originalName)) {
    try {
      utf8.decode(bytes);
    } catch {
      return classify('CORRUPT', ['INVALID_UTF8']);
    }
    return { status: 'ACCEPTED', reasonCodes: [], mediaType: MEDIA_TYPES.markdown };
  }
  if (/\.docx$/iu.test(originalName)) {
    const entries = nestedContainer(bytes, budget);
    if (entries === undefined) return corruptFormat('INVALID_DOCX');
    return docx(entries, budget);
  }
  if (/\.xlsx$/iu.test(originalName)) {
    const entries = nestedContainer(bytes, budget);
    if (entries === undefined) return corruptFormat('INVALID_XLSX');
    return xlsx(entries, budget);
  }
  return classify('UNSUPPORTED', ['UNSUPPORTED_MEDIA_TYPE']);
}

export function entryMetadata(bytes: Buffer): {
  readonly byteLength: number;
  readonly sha256: string;
} {
  return {
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
