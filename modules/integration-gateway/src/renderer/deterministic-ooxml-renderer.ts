// IM-05 WI-05 (issue #125): deterministic minimal OOXML renderers.

import { createHash } from 'node:crypto';

import { getContractRegistry, type Artifact, type Common } from '@zhiju/contracts';
import {
  canonicalize,
  hashCanonicalContentPayload,
  type CanonicalContentPayload,
} from '@zhiju/shared-kernel';

const registry = getContractRegistry();
const UTF8_FLAG = 0x0800;
const STORED_METHOD = 0;
const DOS_TIME = 0;
const DOS_DATE = 33;

export const DOCX_RENDERER_PROFILE = Object.freeze({
  outputFormat: 'document.docx',
  rendererId: 'zhiju.renderer.docx.minimal',
  rendererVersion: '1.0.0',
  mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  extension: 'docx',
  contentType: 'STRUCTURED_DOCUMENT',
} as const);

export const XLSX_RENDERER_PROFILE = Object.freeze({
  outputFormat: 'workbook.xlsx',
  rendererId: 'zhiju.renderer.xlsx.minimal',
  rendererVersion: '1.0.0',
  mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  extension: 'xlsx',
  contentType: 'WORKBOOK_SPEC',
} as const);

export type RendererProfile = typeof DOCX_RENDERER_PROFILE | typeof XLSX_RENDERER_PROFILE;

export interface RenderedOoxmlObject {
  readonly bytes: Buffer;
  readonly checksum: Common.ContentHash;
  readonly mediaType: string;
  readonly extension: 'docx' | 'xlsx';
  readonly rendererId: string;
  readonly rendererVersion: string;
}

export class RendererInputError extends Error {
  constructor(
    readonly code: 'INTEGRATION_RENDER_INPUT_MISMATCH' | 'INTEGRATION_ADAPTER_VERSION_UNSUPPORTED',
    message: string,
  ) {
    super(message);
    this.name = 'RendererInputError';
  }
}

interface ZipEntry {
  readonly name: string;
  readonly data: Buffer;
}

function contentHash(bytes: Buffer): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: createHash('sha256').update(bytes).digest('hex'),
    canonicalizationVersion: '1',
  };
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: readonly ZipEntry[]): Buffer {
  const sorted = [...entries].sort((left, right) =>
    Buffer.compare(Buffer.from(left.name, 'utf8'), Buffer.from(right.name, 'utf8')),
  );
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of sorted) {
    const name = Buffer.from(entry.name, 'utf8');
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(STORED_METHOD, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(STORED_METHOD, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function textEntry(name: string, value: string): ZipEntry {
  return { name, data: Buffer.from(value, 'utf8') };
}

function orderedDocumentUnits(
  document: Artifact.CanonicalDocument,
): readonly Artifact.CanonicalDocumentUnit[] {
  const byId = new Map(document.units.map((unit) => [unit.unitId, unit]));
  const compare = (left: Artifact.CanonicalDocumentUnit, right: Artifact.CanonicalDocumentUnit) =>
    left.ordinal - right.ordinal || left.unitId.localeCompare(right.unitId);
  const roots = document.units.filter((unit) => unit.parentUnitId === undefined).sort(compare);
  const ordered: Artifact.CanonicalDocumentUnit[] = [];
  const visit = (unit: Artifact.CanonicalDocumentUnit): void => {
    ordered.push(unit);
    unit.childUnitIds
      .map((id) => byId.get(id))
      .filter((candidate): candidate is Artifact.CanonicalDocumentUnit => candidate !== undefined)
      .sort(compare)
      .forEach(visit);
  };
  roots.forEach(visit);
  return ordered;
}

function documentParagraph(unit: Artifact.CanonicalDocumentUnit): string {
  const text = unit.text ?? `[${unit.unitType}:${unit.unitId}]`;
  const style = unit.unitType === 'SECTION' ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : '';
  return `<w:p>${style}<w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
}

function renderDocx(document: Artifact.CanonicalDocument): Buffer {
  const body = orderedDocumentUnits(document).map(documentParagraph).join('');
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>${xml(document.title)}</w:t></w:r></w:p>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(document.title)}</dc:title><dc:creator>Zhiju Renderer</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:created></cp:coreProperties>`;
  return zip([
    textEntry('[Content_Types].xml', contentTypes),
    textEntry('_rels/.rels', rootRels),
    textEntry('docProps/core.xml', core),
    textEntry('word/_rels/document.xml.rels', documentRels),
    textEntry('word/document.xml', documentXml),
    textEntry('word/styles.xml', styles),
  ]);
}

function columnName(index: number): string {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function inlineCell(reference: string, value: string): string {
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function workbookCell(reference: string, cell: Artifact.CanonicalWorkbookCell | undefined): string {
  if (cell === undefined) return '';
  if (cell.formula !== undefined) {
    const formula = cell.formula.startsWith('=') ? cell.formula.slice(1) : cell.formula;
    return `<c r="${reference}"><f>${xml(formula)}</f></c>`;
  }
  const value = cell.value;
  if (value === undefined || value === null) return `<c r="${reference}"/>`;
  if (typeof value === 'boolean') return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  if (typeof value === 'number') return `<c r="${reference}"><v>${value}</v></c>`;
  const rendered = typeof value === 'string' ? value : canonicalize(value);
  return inlineCell(reference, rendered);
}

function renderWorksheet(sheet: Artifact.CanonicalWorkbookSheet): string {
  const columns = [...sheet.columns].sort(
    (left, right) => left.ordinal - right.ordinal || left.columnId.localeCompare(right.columnId),
  );
  const header = columns
    .map((column, index) => inlineCell(`${columnName(index)}1`, column.name))
    .join('');
  const rows = [...sheet.rows]
    .sort((left, right) => left.ordinal - right.ordinal || left.rowId.localeCompare(right.rowId))
    .map((row, rowIndex) => {
      const byColumn = new Map(row.cells.map((cell) => [cell.columnId, cell]));
      const cells = columns
        .map((column, columnIndex) =>
          workbookCell(`${columnName(columnIndex)}${rowIndex + 2}`, byColumn.get(column.columnId)),
        )
        .join('');
      return `<row r="${rowIndex + 2}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${header}</row>${rows}</sheetData></worksheet>`;
}

function renderXlsx(workbook: Artifact.CanonicalWorkbookSpec): Buffer {
  const sheets = [...workbook.sheets].sort(
    (left, right) => left.ordinal - right.ordinal || left.sheetId.localeCompare(right.sheetId),
  );
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_sheet, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name.slice(0, 31))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets><calcPr calcMode="manual"/></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>`;
  return zip([
    textEntry('[Content_Types].xml', contentTypes),
    textEntry('_rels/.rels', rootRels),
    textEntry('xl/_rels/workbook.xml.rels', workbookRels),
    textEntry('xl/styles.xml', styles),
    textEntry('xl/workbook.xml', workbookXml),
    ...sheets.map((sheet, index) =>
      textEntry(`xl/worksheets/sheet${index + 1}.xml`, renderWorksheet(sheet)),
    ),
  ]);
}

function exactHash(left: Common.ContentHash, right: Common.ContentHash): boolean {
  return left.digest === right.digest;
}

export function resolveRendererProfile(input: {
  readonly outputFormat: string;
  readonly rendererId: string;
  readonly rendererVersion: string;
}): RendererProfile {
  for (const profile of [DOCX_RENDERER_PROFILE, XLSX_RENDERER_PROFILE] as const) {
    if (
      input.outputFormat === profile.outputFormat &&
      input.rendererId === profile.rendererId &&
      input.rendererVersion === profile.rendererVersion
    ) {
      return profile;
    }
  }
  throw new RendererInputError(
    'INTEGRATION_ADAPTER_VERSION_UNSUPPORTED',
    'render format, renderer ID, or renderer version is outside the approved profile',
  );
}

export function renderCanonicalContent(input: {
  readonly payload: Artifact.CanonicalContentPayload;
  readonly declaredInputHash: Common.ContentHash;
  readonly profile: RendererProfile;
}): RenderedOoxmlObject {
  const validation = registry.validateCanonicalContent(input.payload);
  if (!validation.valid) {
    throw new RendererInputError(
      'INTEGRATION_RENDER_INPUT_MISMATCH',
      'canonical render input failed executable schema validation',
    );
  }
  const calculatedHash = hashCanonicalContentPayload(
    input.payload as unknown as CanonicalContentPayload,
  );
  if (!exactHash(calculatedHash, input.declaredInputHash)) {
    throw new RendererInputError(
      'INTEGRATION_RENDER_INPUT_MISMATCH',
      'canonical render input bytes do not match the declared input hash',
    );
  }
  if (input.payload.contentType !== input.profile.contentType) {
    throw new RendererInputError(
      'INTEGRATION_RENDER_INPUT_MISMATCH',
      'canonical content type does not match the renderer profile',
    );
  }
  const bytes =
    input.payload.contentType === 'STRUCTURED_DOCUMENT'
      ? renderDocx(input.payload.body)
      : renderXlsx(input.payload.body);
  return {
    bytes,
    checksum: contentHash(bytes),
    mediaType: input.profile.mediaType,
    extension: input.profile.extension,
    rendererId: input.profile.rendererId,
    rendererVersion: input.profile.rendererVersion,
  };
}
