// #270: closed Markdown -> canonical STRUCTURED_DOCUMENT pipeline. Artifact owns
// parsing, canonical metadata/graph validation, identity sidecar validation and
// round-trip verification; deterministic rendering is owned by IntegrationGateway.
//
// Bounded supported grammar (Delta §3 / ART §13.2):
//   - UTF-8 with an optional BOM; CRLF/CR are normalized to LF as a derived
//     normalization that never replaces the original raw bytes or their hash.
//   - ATX headings 1..6 (repeated H1s stay independent SECTIONs), paragraphs,
//     thematic breaks, ordered/unordered lists with indented continuation and
//     sub-lists, rectangular pipe tables, `**strong**`/`*emphasis*`/`inline code`
//     and the three allowlisted `<br>` hard-break tokens.
//   - Anything else (raw HTML, links/images, code fences, block quotes, front
//     matter, HTML comments, footnotes, setext headings, indented code,
//     ragged/merged tables, unknown syntax) fails closed.

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  getContractRegistry,
  markdownDocumentLimits,
  markdownDocumentSchemaReference,
  type Artifact,
  type Common,
  type MarkdownLimits,
} from '@zhiju/contracts';
import {
  canonicalizeCanonicalContentPayload,
  contentHash,
  hashCanonicalContentPayload,
  type CanonicalContentPayload as SharedCanonicalContentPayload,
} from '@zhiju/shared-kernel';

import {
  ArtifactBusinessError,
  ARTIFACT_MARKDOWN_IDENTITY_INVALID,
  ARTIFACT_MARKDOWN_LIMIT,
  ARTIFACT_MARKDOWN_LOSSY,
  ARTIFACT_MARKDOWN_UNSAFE,
  ARTIFACT_MARKDOWN_UNSUPPORTED,
} from './artifact-business-errors.js';

/** Deterministic parser profile of the `artifact.markdown_document@1.0` pipeline. */
export const MARKDOWN_PARSER_PROFILE = Object.freeze({
  profileKey: 'artifact.markdown_document@1.0',
  registryKey: 'artifact.markdown_document.schema@1.0',
  parserId: 'zhiju.parser.markdown.canonical',
  parserVersion: '1.0.0',
} as const);

/** Context a new identity is derived from: original intent + candidate output + node path. */
export interface MarkdownIdentityDerivation {
  readonly originalIntentRef: string;
  readonly candidateOutputId: string;
}

export interface MarkdownSourceNodeFact {
  readonly sourceNodePath: string;
  readonly unitId: string;
  readonly type: Artifact.MarkdownIdentityMapNode['type'];
  readonly parentUnitId?: string;
  readonly ordinal: number;
}

export interface MarkdownSourceColumnFact {
  readonly tableUnitId: string;
  readonly columnId: string;
  readonly ordinal: number;
}

/**
 * The exact owning facts identities may be inherited from. Required with
 * `identityMap`: a sidecar alone cannot prove which Artifact/Project/output/base
 * or source mapping it belongs to.
 */
export interface MarkdownIdentityBinding {
  readonly artifactRef: Common.ObjectRef;
  readonly baseRevisionRef?: Common.ContentAddressedRef;
  readonly baselineMappingRef?: Common.SnapshotRef;
}

export interface MarkdownParseRequest {
  /** Original raw bytes; never rewritten. */
  readonly bytes: Uint8Array;
  readonly enterpriseId: string;
  /** Confirmed documentIdentity. */
  readonly documentId: string;
  readonly title: string;
  readonly documentMetadata: Artifact.MarkdownDocumentMetadata;
  readonly identityDerivation: MarkdownIdentityDerivation;
  /** Authoritative identity sidecar; only its identities are inherited. */
  readonly identityMap?: Artifact.MarkdownIdentityMap;
  /** Required with `identityMap`; must match the sidecar exactly. */
  readonly identityBinding?: MarkdownIdentityBinding;
  /** Skip the sidecar raw-byte binding when re-parsing derived render output. */
  readonly enforceRawBytesBinding?: boolean;
  readonly now?: () => number;
}

export interface MarkdownParseResult {
  readonly content: Artifact.MarkdownDocumentContent;
  readonly rawBytesSha256: Common.ContentHash;
  readonly contentHash: Common.ContentHash;
  readonly canonicalJson: string;
  readonly sourceNodes: readonly MarkdownSourceNodeFact[];
  readonly sourceColumns: readonly MarkdownSourceColumnFact[];
  readonly identityDerivation: MarkdownIdentityDerivation;
  readonly readLimits: MarkdownLimits;
}

export interface MarkdownRoundTripRequest {
  readonly content: Artifact.MarkdownDocumentContent;
  readonly enterpriseId: string;
  readonly identityDerivation: MarkdownIdentityDerivation;
  readonly identityMap: Artifact.MarkdownIdentityMap;
  readonly identityBinding: MarkdownIdentityBinding;
  /** Bytes produced by the deterministic renderer for `content`. */
  readonly renderedBytes: Uint8Array;
  readonly now?: () => number;
}

/** Builds the closed identity sidecar for the identities a parse produced. */
export function buildMarkdownIdentityMap(input: {
  readonly parse: MarkdownParseResult;
  readonly artifactRef: Common.ObjectRef;
  readonly profileRef: Common.VersionedRef;
  readonly baseRevisionRef?: Common.ContentAddressedRef;
  readonly baselineMappingRef?: Common.SnapshotRef;
}): Artifact.MarkdownIdentityMap {
  return {
    profileRef: input.profileRef,
    artifactRef: input.artifactRef,
    documentId: input.parse.content.body.documentId,
    ...(input.baseRevisionRef === undefined ? {} : { baseRevisionRef: input.baseRevisionRef }),
    ...(input.baselineMappingRef === undefined
      ? {}
      : { baselineMappingRef: input.baselineMappingRef }),
    candidateOutputId: input.parse.identityDerivation.candidateOutputId,
    markdownBytesSha256: input.parse.rawBytesSha256,
    nodes: input.parse.sourceNodes.map((node) => ({
      sourceNodePath: node.sourceNodePath,
      unitId: node.unitId,
      type: node.type,
      ...(node.parentUnitId === undefined ? {} : { parentUnitId: node.parentUnitId }),
      ordinal: node.ordinal,
    })),
    columns: input.parse.sourceColumns.map((column) => ({ ...column })),
  };
}

const registry = getContractRegistry();

const HEADING_PATTERN = /^(#{1,6})[ \t]+(.*)$/u;
const LIST_PATTERN = /^([-+*]|\d{1,9}[.)])[ \t]+(.*)$/u;
const THEMATIC_PATTERN = /^(?:\*[ \t]*){3,}$|^(?:-[ \t]*){3,}$|^(?:_[ \t]*){3,}$/u;
const SETEXT_PATTERN = /^(?:=+|-+)[ \t]*$/u;
const SEPARATOR_CELL = /^:?-+:?$/u;
const UNSUPPORTED_BLOCK = /^(?:```|~~~|>|<!--)/u;
const TASK_LIST_PATTERN = /^\[[ xX]\](?:[ \t]|$)/u;
const ESCAPABLE = /[!-/:-@[-`{-~]/u;

class MarkdownParseError extends ArtifactBusinessError {}

function fail(code: string, message: string): never {
  throw new MarkdownParseError(code, message);
}

/**
 * Generated Artifact contract types mirror the shared-kernel canonical payload
 * shape; the shared hashing helpers are typed against that mirror.
 */
function sharedPayload(content: Artifact.MarkdownDocumentContent): SharedCanonicalContentPayload {
  return content as unknown as SharedCanonicalContentPayload;
}

export function deriveMarkdownUnitId(
  derivation: MarkdownIdentityDerivation,
  nodePath: string,
): string {
  return derivedIdentity(derivation, 'u', nodePath);
}

export function deriveMarkdownColumnId(
  derivation: MarkdownIdentityDerivation,
  tableNodePath: string,
  ordinal: number,
): string {
  return derivedIdentity(derivation, 'c', `${tableNodePath}#${ordinal}`);
}

/**
 * List grouping identity of one run: structural only, so an authoritative
 * identity map reproduces it regardless of the derivation context.
 */
export function markdownListId(firstItemNodePath: string): string {
  return `list:${firstItemNodePath}`;
}

function derivedIdentity(
  derivation: MarkdownIdentityDerivation,
  scope: string,
  nodePath: string,
): string {
  const digest = createHash('sha256')
    .update(
      `${derivation.originalIntentRef}\u0000${derivation.candidateOutputId}\u0000${scope}\u0000${nodePath}`,
      'utf8',
    )
    .digest('hex');
  return `md1:${scope}${digest.slice(0, 31)}`;
}

// --- source decoding -------------------------------------------------------

interface DecodedSource {
  readonly text: string;
  readonly rawBytesSha256: Common.ContentHash;
}

function decodeSource(bytes: Uint8Array): DecodedSource {
  if (bytes.byteLength > markdownDocumentLimits.maxFileBytes) {
    fail(
      ARTIFACT_MARKDOWN_LIMIT,
      `Markdown file exceeds the approved byte budget of ${markdownDocumentLimits.maxFileBytes}`,
    );
  }
  const rawBytesSha256 = contentHash(createHash('sha256').update(bytes).digest('hex'));
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail(ARTIFACT_MARKDOWN_UNSUPPORTED, 'Markdown source is not valid UTF-8');
  }
  const withoutBom = decoded.startsWith('\uFEFF') ? decoded.slice(1) : decoded;
  return { text: withoutBom.replaceAll('\r\n', '\n').replaceAll('\r', '\n'), rawBytesSha256 };
}

// --- block scanning --------------------------------------------------------

type Alignment = 'NONE' | 'LEFT' | 'CENTER' | 'RIGHT';

interface AstColumn {
  readonly alignment: Alignment;
}

interface AstRow {
  readonly header: boolean;
  readonly cells: readonly string[];
}

interface AstNode {
  readonly kind: 'SECTION' | 'PARAGRAPH' | 'THEMATIC_BREAK' | 'LIST' | 'LIST_ITEM' | 'TABLE';
  readonly level?: number;
  inline?: string;
  /** Raw source lines of a list item, joined after the list run is scanned. */
  lines?: string[];
  readonly listKind?: 'ORDERED' | 'UNORDERED';
  readonly listOrdinal?: number;
  readonly listDepth?: number;
  readonly orderedMarker?: string;
  readonly children: AstNode[];
  readonly columns?: readonly AstColumn[];
  readonly rows?: readonly AstRow[];
}

function indentationOf(line: string): number {
  return /^ */u.exec(line)?.[0].length ?? 0;
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function hasUnescapedPipe(line: string): boolean {
  let escaped = false;
  for (const character of line) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '|') return true;
  }
  return false;
}

function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let escaped = false;
  for (const character of line) {
    if (escaped) {
      current += `\\${character}`;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '|') {
      cells.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  cells.push(current);
  if (line.trimStart().startsWith('|')) cells.shift();
  if (line.trimEnd().endsWith('|') && cells.length > 0) cells.pop();
  return cells.map((cell) => cell.replace(/^[ \t]+|[ \t]+$/gu, ''));
}

function isSeparatorRow(line: string): boolean {
  if (!hasUnescapedPipe(line)) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL.test(cell));
}

function alignmentOf(separatorCell: string): Alignment {
  const left = separatorCell.startsWith(':');
  const right = separatorCell.endsWith(':');
  if (left && right) return 'CENTER';
  if (left) return 'LEFT';
  if (right) return 'RIGHT';
  return 'NONE';
}

function joinParagraphLines(lines: readonly string[]): string {
  let out = '';
  for (const [index, line] of lines.entries()) {
    const isLast = index === lines.length - 1;
    if (isLast) {
      out += line.replace(/[ \t]+$/u, '');
      continue;
    }
    const trailingSpaces = /[ \t]{2,}$/u.exec(line);
    const trailingBackslashes = /\\+$/u.exec(line)?.[0].length ?? 0;
    if (trailingSpaces !== null) {
      out += `${line.slice(0, trailingSpaces.index)}\n`;
    } else if (trailingBackslashes % 2 === 1) {
      out += `${line.slice(0, -1)}\n`;
    } else {
      out += `${line} `;
    }
  }
  return out;
}

class BlockScanner {
  readonly #lines: readonly string[];
  readonly #deadline: number;
  #units = 0;

  constructor(lines: readonly string[], now: () => number) {
    this.#lines = lines;
    this.#deadline = now() + markdownDocumentLimits.maxParseMilliseconds;
  }

  #checkDeadline(): void {
    if (Date.now() > this.#deadline) {
      fail(
        ARTIFACT_MARKDOWN_LIMIT,
        `Markdown parsing exceeded the approved budget of ${markdownDocumentLimits.maxParseMilliseconds}ms`,
      );
    }
  }

  #countUnit(depth?: number): void {
    this.#units += 1;
    if (this.#units > markdownDocumentLimits.maxUnits) {
      fail(
        ARTIFACT_MARKDOWN_LIMIT,
        `Markdown document exceeds the approved unit budget of ${markdownDocumentLimits.maxUnits}`,
      );
    }
    if (depth !== undefined && depth > markdownDocumentLimits.maxBlockDepth) {
      fail(
        ARTIFACT_MARKDOWN_LIMIT,
        `Markdown block depth ${depth} exceeds the approved maximum of ${markdownDocumentLimits.maxBlockDepth}`,
      );
    }
    this.#checkDeadline();
  }

  scan(): readonly AstNode[] {
    return this.#scanRange(0, this.#lines.length);
  }

  #scanRange(start: number, end: number): readonly AstNode[] {
    const nodes: AstNode[] = [];
    const sectionStack: { level: number; children: AstNode[] }[] = [];
    const attach = (node: AstNode): void => {
      (sectionStack.at(-1)?.children ?? nodes).push(node);
    };

    // A setext underline is only meaningful directly below a paragraph line at
    // the same block level; the line immediately before a block start decides
    // whether `-`/`=` runs are an underline or a thematic break.
    let previousWasParagraph = false;
    let previousBlockEnd = -1;

    let index = start;
    while (index < end) {
      this.#checkDeadline();
      const line = this.#lines[index] ?? '';
      if (isBlank(line)) {
        index += 1;
        continue;
      }
      const indent = indentationOf(line);
      if (indent >= 4) {
        fail(
          ARTIFACT_MARKDOWN_UNSUPPORTED,
          `indented code blocks are not supported (line ${index + 1})`,
        );
      }
      const content = line.slice(indent);

      if (UNSUPPORTED_BLOCK.test(content)) {
        fail(
          ARTIFACT_MARKDOWN_UNSUPPORTED,
          `unsupported Markdown block syntax (line ${index + 1})`,
        );
      }

      const heading = HEADING_PATTERN.exec(content);
      if (heading !== null) {
        const level = heading[1]?.length ?? 1;
        const text = (heading[2] ?? '').replace(/[ \t]+#*[ \t]*$/u, '');
        this.#countUnit(level);
        while ((sectionStack.at(-1)?.level ?? 0) >= level) sectionStack.pop();
        const node: AstNode = { kind: 'SECTION', inline: text, level, children: [] };
        const parent = sectionStack.at(-1);
        (parent?.children ?? nodes).push(node);
        sectionStack.push({ level, children: node.children });
        index += 1;
        previousWasParagraph = false;
        previousBlockEnd = index;
        continue;
      }

      if (SETEXT_PATTERN.test(content) && previousWasParagraph && previousBlockEnd === index) {
        fail(
          ARTIFACT_MARKDOWN_UNSUPPORTED,
          `setext headings are not supported (line ${index + 1})`,
        );
      }

      if (THEMATIC_PATTERN.test(content)) {
        this.#countUnit();
        attach({ kind: 'THEMATIC_BREAK', children: [] });
        index += 1;
        previousWasParagraph = false;
        previousBlockEnd = index;
        continue;
      }

      if (LIST_PATTERN.test(content)) {
        const list = this.#scanList(index, end, indent);
        this.#countAstUnits(list.node);
        attach(list.node);
        index = list.next;
        previousWasParagraph = false;
        previousBlockEnd = index;
        continue;
      }

      if (hasUnescapedPipe(content) && isSeparatorRow(this.#lines[index + 1] ?? '')) {
        const table = this.#scanTable(index, end);
        attach(table.node);
        index = table.next;
        previousWasParagraph = false;
        previousBlockEnd = index;
        continue;
      }

      const paragraph = this.#scanParagraph(index, end);
      this.#countUnit();
      attach({ kind: 'PARAGRAPH', inline: paragraph.inline, children: [] });
      index = paragraph.next;
      previousWasParagraph = true;
      previousBlockEnd = index;
    }

    return nodes;
  }

  #countAstUnits(node: AstNode): void {
    if (node.kind === 'LIST_ITEM') this.#countUnit(node.listDepth);
    for (const child of node.children) this.#countAstUnits(child);
  }

  #scanParagraph(start: number, end: number): { inline: string; next: number } {
    const lines: string[] = [];
    let index = start;
    while (index < end) {
      const line = this.#lines[index] ?? '';
      if (isBlank(line)) break;
      const indent = indentationOf(line);
      if (indent >= 4) {
        fail(
          ARTIFACT_MARKDOWN_UNSUPPORTED,
          `indented code blocks are not supported (line ${index + 1})`,
        );
      }
      const content = line.slice(indent);
      // A following block start (heading, thematic break, setext underline,
      // list, table or unsupported block) ends this paragraph and is decided by
      // the enclosing block scanner.
      if (lines.length > 0 && this.#startsNewBlock(content, index)) break;
      lines.push(content);
      index += 1;
    }
    return { inline: joinParagraphLines(lines), next: index };
  }

  /** True when the line starts a new block rather than continuing a paragraph. */
  #startsNewBlock(content: string, index: number): boolean {
    return (
      HEADING_PATTERN.test(content) ||
      THEMATIC_PATTERN.test(content) ||
      SETEXT_PATTERN.test(content) ||
      LIST_PATTERN.test(content) ||
      UNSUPPORTED_BLOCK.test(content) ||
      (hasUnescapedPipe(content) && isSeparatorRow(this.#lines[index + 1] ?? ''))
    );
  }

  #scanList(start: number, end: number, baseIndent: number): { node: AstNode; next: number } {
    const firstMarker = LIST_PATTERN.exec((this.#lines[start] ?? '').slice(baseIndent));
    if (firstMarker === null) {
      return fail(ARTIFACT_MARKDOWN_UNSUPPORTED, 'malformed list item');
    }
    const listDepth = baseIndent === 0 ? 1 : Math.floor(baseIndent / 2) + 1;
    const items: AstNode[] = [];
    let index = start;

    while (index < end) {
      this.#checkDeadline();
      const line = this.#lines[index] ?? '';
      if (isBlank(line)) {
        let lookahead = index + 1;
        while (lookahead < end && isBlank(this.#lines[lookahead] ?? '')) lookahead += 1;
        const nextLine = this.#lines[lookahead] ?? '';
        const nextIndent = indentationOf(nextLine);
        if (
          lookahead < end &&
          nextIndent >= baseIndent &&
          (LIST_PATTERN.test(nextLine.slice(nextIndent)) || nextIndent > baseIndent)
        ) {
          index = lookahead;
          continue;
        }
        break;
      }

      const indent = indentationOf(line);
      if (indent < baseIndent) break;
      const content = line.slice(indent);
      const marker = LIST_PATTERN.exec(content);

      if (marker !== null && indent === baseIndent) {
        // `- - -` / `* * *` satisfy both the list and thematic-break grammar;
        // the thematic break wins and terminates the list.
        if (THEMATIC_PATTERN.test(content)) break;
        const markerToken = marker[1] ?? '';
        const ordered = /^\d/u.test(markerToken);
        const itemText = marker[2] ?? '';
        if (TASK_LIST_PATTERN.test(itemText)) {
          fail(
            ARTIFACT_MARKDOWN_UNSUPPORTED,
            `unsupported task-list extension (line ${index + 1})`,
          );
        }
        items.push({
          kind: 'LIST_ITEM',
          lines: [itemText],
          listKind: ordered ? 'ORDERED' : 'UNORDERED',
          listOrdinal: ordered ? Number.parseInt(markerToken.slice(0, -1), 10) : items.length + 1,
          listDepth,
          ...(ordered ? { orderedMarker: markerToken } : {}),
          children: [],
        });
        index += 1;
        continue;
      }

      const current = items.at(-1);
      if (current === undefined) break;

      if (marker !== null && indent > baseIndent) {
        const nested = this.#scanList(index, end, indent);
        current.children.push(nested.node);
        index = nested.next;
        continue;
      }

      // An indented setext underline would turn the item's paragraph into a
      // setext heading, which this profile does not support.
      if (SETEXT_PATTERN.test(content) && indent > baseIndent) {
        fail(
          ARTIFACT_MARKDOWN_UNSUPPORTED,
          `setext headings are not supported (line ${index + 1})`,
        );
      }

      // An indented continuation belongs to the current item; a heading,
      // thematic break, table start or unsupported block terminates the list
      // and is handled by the enclosing block scanner.
      if (this.#startsBlock(content, index)) break;
      const lines = current.lines ?? [];
      lines.push(content);
      current.lines = lines;
      index += 1;
    }

    for (const item of items) {
      item.inline = joinParagraphLines(item.lines ?? []);
    }

    return {
      node: { kind: 'LIST', children: items },
      next: index,
    };
  }

  /** True when the line starts a block the current list must not consume. */
  #startsBlock(content: string, index: number): boolean {
    return (
      HEADING_PATTERN.test(content) ||
      THEMATIC_PATTERN.test(content) ||
      UNSUPPORTED_BLOCK.test(content) ||
      (hasUnescapedPipe(content) && isSeparatorRow(this.#lines[index + 1] ?? ''))
    );
  }

  #scanTable(start: number, end: number): { node: AstNode; next: number } {
    const headerLine = this.#lines[start] ?? '';
    const columns = splitTableRow(this.#lines[start + 1] ?? '').map((cell) => ({
      alignment: alignmentOf(cell),
    }));
    if (columns.length === 0) {
      return fail(ARTIFACT_MARKDOWN_UNSUPPORTED, `malformed table separator (line ${start + 2})`);
    }
    if (columns.length > markdownDocumentLimits.maxTableColumns) {
      return fail(
        ARTIFACT_MARKDOWN_LIMIT,
        `table column count exceeds the approved maximum of ${markdownDocumentLimits.maxTableColumns}`,
      );
    }

    const headerCells = splitTableRow(headerLine);
    if (headerCells.length !== columns.length) {
      return fail(
        ARTIFACT_MARKDOWN_UNSUPPORTED,
        `ragged table header: ${headerCells.length} cells for ${columns.length} columns (line ${start + 1})`,
      );
    }

    const rows: AstRow[] = [{ header: true, cells: headerCells }];
    let index = start + 2;
    while (index < end) {
      const line = this.#lines[index] ?? '';
      if (isBlank(line) || indentationOf(line) >= 4 || !hasUnescapedPipe(line)) break;
      if (rows.length > markdownDocumentLimits.maxTableRows) {
        return fail(
          ARTIFACT_MARKDOWN_LIMIT,
          `table row count exceeds the approved maximum of ${markdownDocumentLimits.maxTableRows}`,
        );
      }
      const cells = splitTableRow(line);
      if (cells.length !== columns.length) {
        return fail(
          ARTIFACT_MARKDOWN_UNSUPPORTED,
          `ragged table row: ${cells.length} cells for ${columns.length} columns (line ${index + 1})`,
        );
      }
      rows.push({ header: false, cells });
      index += 1;
    }

    // Count the table, every row and every cell against the total Unit budget
    // before materialization, like the paragraph and list paths do.
    this.#countUnit();
    const rowUnitCount = rows.reduce((total, row) => total + 1 + row.cells.length, 0);
    for (let counted = 0; counted < rowUnitCount; counted += 1) this.#countUnit();

    return { node: { kind: 'TABLE', children: [], columns, rows }, next: index };
  }
}

// --- inline scanning ------------------------------------------------------

/** Allowlisted pure hard-break tokens; every other HTML tag is unsafe. */
const BR_TOKENS = ['<br />', '<br/>', '<br>'] as const;
const SCRIPT_PREFIX = 'javascript:';

function parseInline(source: string): { text: string; spans: Artifact.MarkdownInlineSpan[] } {
  const characters = Array.from(source);
  const out: string[] = [];
  const spans: Artifact.MarkdownInlineSpan[] = [];
  let index = 0;

  const push = (value: string): void => {
    for (const character of value) out.push(character);
  };

  const matchesAt = (at: number, expected: string, ignoreCase = false): boolean => {
    for (let offset = 0; offset < expected.length; offset += 1) {
      const actual = characters[at + offset];
      const wanted = expected[offset];
      if (actual === undefined || wanted === undefined) return false;
      if (ignoreCase ? actual.toLowerCase() !== wanted : actual !== wanted) return false;
    }
    return true;
  };

  while (index < characters.length) {
    const character = characters[index];
    if (character === undefined) break;

    // Escapes come first: an escaped punctuation is literal text, never a marker.
    if (character === '\\') {
      const next = characters[index + 1];
      if (next !== undefined && ESCAPABLE.test(next)) {
        out.push(next);
        index += 2;
        continue;
      }
      out.push(character);
      index += 1;
      continue;
    }

    if (character === '\n') {
      spans.push({ start: out.length, end: out.length + 1, kind: 'HARD_BREAK' });
      out.push('\n');
      index += 1;
      continue;
    }

    // Dangerous and unsupported inline syntax is judged per position, outside
    // CODE spans only, so inline code keeps its literal content (ART §13.2).
    if (character === '!' && characters[index + 1] === '[') {
      fail(ARTIFACT_MARKDOWN_UNSAFE, 'Markdown images are not supported');
    }
    if (character === ']' && (characters[index + 1] === '(' || characters[index + 1] === '[')) {
      fail(ARTIFACT_MARKDOWN_UNSAFE, 'Markdown links are not supported');
    }
    if (character === '[' && characters[index + 1] === '^') {
      fail(ARTIFACT_MARKDOWN_UNSUPPORTED, 'footnotes are not supported');
    }
    if (character === '~' && characters[index + 1] === '~') {
      fail(ARTIFACT_MARKDOWN_UNSUPPORTED, 'the strikethrough extension is not supported');
    }
    if ((character === 'j' || character === 'J') && matchesAt(index, SCRIPT_PREFIX, true)) {
      fail(ARTIFACT_MARKDOWN_UNSAFE, 'Markdown script URLs are not supported');
    }

    if (character === '<') {
      const token = BR_TOKENS.find((candidate) => matchesAt(index, candidate));
      if (token === undefined) fail(ARTIFACT_MARKDOWN_UNSAFE, 'raw HTML is not supported');
      spans.push({ start: out.length, end: out.length + 1, kind: 'HARD_BREAK' });
      out.push('\n');
      index += token.length;
      continue;
    }

    if (character === '`') {
      const run = runLength(characters, index, '`');
      const close = findRun(characters, index + run, '`', run);
      if (close === -1) {
        push('`'.repeat(run));
        index += run;
        continue;
      }
      let code = characters.slice(index + run, close).join('');
      if (code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') {
        code = code.slice(1, -1);
      }
      const start = out.length;
      push(code);
      spans.push({ start, end: out.length, kind: 'CODE' });
      index = close + run;
      continue;
    }

    if (character === '*') {
      const run = Math.min(runLength(characters, index, '*'), 3);
      const close = findRun(characters, index + run, '*', run);
      if (close === -1) {
        push('*'.repeat(run));
        index += run;
        continue;
      }
      const inner = parseInline(characters.slice(index + run, close).join(''));
      if (inner.spans.length > 0) {
        fail(ARTIFACT_MARKDOWN_UNSUPPORTED, 'nested inline formatting is not supported');
      }
      const start = out.length;
      push(inner.text);
      if (run >= 2) spans.push({ start, end: out.length, kind: 'STRONG' });
      if (run === 1 || run === 3) spans.push({ start, end: out.length, kind: 'EMPHASIS' });
      index = close + run;
      continue;
    }

    out.push(character);
    index += 1;
  }

  return { text: out.join(''), spans };
}

function runLength(characters: readonly string[], start: number, marker: string): number {
  let length = 0;
  while (characters[start + length] === marker) length += 1;
  return length;
}

function findRun(
  characters: readonly string[],
  start: number,
  marker: string,
  run: number,
): number {
  let index = start;
  while (index < characters.length) {
    if (characters[index] === '\\') {
      index += 2;
      continue;
    }
    if (characters[index] === marker && runLength(characters, index, marker) === run) return index;
    index += 1;
  }
  return -1;
}

// --- materialization ------------------------------------------------------

interface MaterializeContext {
  readonly derivation: MarkdownIdentityDerivation;
  readonly identityByPath: ReadonlyMap<string, Artifact.MarkdownIdentityMapNode> | undefined;
  readonly columnIdentity: ReadonlyMap<string, Artifact.MarkdownIdentityMapColumn> | undefined;
}

/** Materialized subtree: pre-order units plus the ids that are direct children. */
interface MaterializedSubtree {
  readonly units: Artifact.MarkdownDocumentUnit[];
  readonly rootIds: string[];
}

function assertLogicalText(value: string): void {
  const length = Array.from(value).length;
  if (length > markdownDocumentLimits.maxLogicalTextCodePoints) {
    fail(
      ARTIFACT_MARKDOWN_LIMIT,
      `logical text exceeds the approved budget of ${markdownDocumentLimits.maxLogicalTextCodePoints} code points`,
    );
  }
}

class Materializer {
  readonly #context: MaterializeContext;
  readonly #sourceNodes: MarkdownSourceNodeFact[] = [];
  readonly #sourceColumns: MarkdownSourceColumnFact[] = [];

  constructor(context: MaterializeContext) {
    this.#context = context;
  }

  get sourceNodes(): readonly MarkdownSourceNodeFact[] {
    return this.#sourceNodes;
  }

  get sourceColumns(): readonly MarkdownSourceColumnFact[] {
    return this.#sourceColumns;
  }

  materialize(
    nodes: readonly AstNode[],
    parentPath: string,
    parentUnitId: string | undefined,
  ): MaterializedSubtree {
    const units: Artifact.MarkdownDocumentUnit[] = [];
    const rootIds: string[] = [];
    let nextOrdinal = 0;
    for (const [index, node] of nodes.entries()) {
      const path = parentPath === '' ? String(index) : `${parentPath}/${index}`;
      const subtree = this.#materializeNode(node, path, parentUnitId, nextOrdinal);
      nextOrdinal += subtree.rootIds.length;
      units.push(...subtree.units);
      rootIds.push(...subtree.rootIds);
    }
    return { units, rootIds };
  }

  #unitId(path: string, type: Artifact.MarkdownIdentityMapNode['type']): string {
    const declared = this.#context.identityByPath?.get(path);
    if (declared !== undefined) {
      if (declared.type !== type) {
        fail(
          ARTIFACT_MARKDOWN_IDENTITY_INVALID,
          `identity sidecar declares type ${declared.type} for ${path} but the parsed unit is ${type}`,
        );
      }
      return declared.unitId;
    }
    return deriveMarkdownUnitId(this.#context.derivation, path);
  }

  #record(
    path: string,
    unitId: string,
    type: Artifact.MarkdownIdentityMapNode['type'],
    parentUnitId: string | undefined,
    ordinal: number,
  ): void {
    this.#sourceNodes.push({
      sourceNodePath: path,
      unitId,
      type,
      ...(parentUnitId === undefined ? {} : { parentUnitId }),
      ordinal,
    });
  }

  #materializeNode(
    node: AstNode,
    path: string,
    parentUnitId: string | undefined,
    ordinal: number,
  ): MaterializedSubtree {
    switch (node.kind) {
      case 'SECTION': {
        const unitId = this.#unitId(path, 'SECTION');
        const inline = parseInline(node.inline ?? '');
        assertLogicalText(inline.text);
        const children = this.materialize(node.children, path, unitId);
        const unit: Artifact.MarkdownSectionUnit = {
          unitId,
          ...(parentUnitId === undefined ? {} : { parentUnitId }),
          unitType: 'SECTION',
          ordinal,
          text: inline.text,
          childUnitIds: children.rootIds,
          semanticMetadata: {
            markdown: { headingLevel: node.level ?? 1, inlineSpans: inline.spans },
          },
        };
        this.#record(path, unitId, 'SECTION', parentUnitId, ordinal);
        return { units: [unit, ...children.units], rootIds: [unitId] };
      }
      case 'THEMATIC_BREAK': {
        const unitId = this.#unitId(path, 'PARAGRAPH');
        const unit: Artifact.MarkdownThematicBreakUnit = {
          unitId,
          ...(parentUnitId === undefined ? {} : { parentUnitId }),
          unitType: 'PARAGRAPH',
          ordinal,
          childUnitIds: [],
          semanticMetadata: { markdown: { blockKind: 'THEMATIC_BREAK' } },
        };
        this.#record(path, unitId, 'PARAGRAPH', parentUnitId, ordinal);
        return { units: [unit], rootIds: [unitId] };
      }
      case 'LIST':
      case 'LIST_ITEM':
        return this.#materializeList(node, path, parentUnitId, ordinal);
      case 'TABLE':
        return this.#materializeTable(node, path, parentUnitId, ordinal);
      default: {
        const unitId = this.#unitId(path, 'PARAGRAPH');
        const inline = parseInline(node.inline ?? '');
        assertLogicalText(inline.text);
        const unit: Artifact.MarkdownParagraphTextUnit = {
          unitId,
          ...(parentUnitId === undefined ? {} : { parentUnitId }),
          unitType: 'PARAGRAPH',
          ordinal,
          text: inline.text,
          childUnitIds: [],
          semanticMetadata: { markdown: { blockKind: 'TEXT', inlineSpans: inline.spans } },
        };
        this.#record(path, unitId, 'PARAGRAPH', parentUnitId, ordinal);
        return { units: [unit], rootIds: [unitId] };
      }
    }
  }

  #materializeList(
    node: AstNode,
    path: string,
    parentUnitId: string | undefined,
    startOrdinal: number,
  ): MaterializedSubtree {
    const list = node.kind === 'LIST' ? node : { kind: 'LIST' as const, children: [node] };
    const items = list.children;
    const listId = markdownListId(items.length === 0 ? path : `${path}/0`);
    const units: Artifact.MarkdownDocumentUnit[] = [];
    const rootIds: string[] = [];
    for (const [itemIndex, item] of items.entries()) {
      const itemPath = `${path}/${itemIndex}`;
      const itemUnitId = this.#unitId(itemPath, 'PARAGRAPH');
      const inline = parseInline(item.inline ?? '');
      assertLogicalText(inline.text);
      const ordinal = startOrdinal + itemIndex;
      const children = this.materialize(item.children, itemPath, itemUnitId);
      const unit: Artifact.MarkdownListItemUnit = {
        unitId: itemUnitId,
        ...(parentUnitId === undefined ? {} : { parentUnitId }),
        unitType: 'PARAGRAPH',
        ordinal,
        text: inline.text,
        childUnitIds: children.rootIds,
        semanticMetadata: {
          markdown: {
            blockKind: 'LIST_ITEM',
            inlineSpans: inline.spans,
            listId,
            listKind: item.listKind ?? 'UNORDERED',
            listOrdinal: item.listOrdinal ?? itemIndex + 1,
            listDepth: item.listDepth ?? 1,
            ...(item.orderedMarker === undefined ? {} : { orderedMarker: item.orderedMarker }),
          },
        },
      };
      this.#record(itemPath, itemUnitId, 'PARAGRAPH', parentUnitId, ordinal);
      units.push(unit, ...children.units);
      rootIds.push(itemUnitId);
    }
    return { units, rootIds };
  }

  #materializeTable(
    node: AstNode,
    path: string,
    parentUnitId: string | undefined,
    ordinal: number,
  ): MaterializedSubtree {
    const columns = node.columns ?? [];
    const rows = node.rows ?? [];
    const tableUnitId = this.#unitId(path, 'TABLE');
    const columnFacts: Artifact.MarkdownTableColumn[] = columns.map((column, columnIndex) => {
      const declared = this.#context.columnIdentity?.get(`${tableUnitId}#${columnIndex}`);
      const columnId =
        declared?.columnId ?? deriveMarkdownColumnId(this.#context.derivation, path, columnIndex);
      return { columnId, ordinal: columnIndex, alignment: column.alignment };
    });

    const rowUnits: Artifact.MarkdownDocumentUnit[] = [];
    let headerRowUnitId = '';
    for (const [rowIndex, row] of rows.entries()) {
      const rowPath = `${path}/${rowIndex}`;
      const rowUnitId = this.#unitId(rowPath, 'TABLE_ROW');
      if (row.header) headerRowUnitId = rowUnitId;
      const cellUnits: Artifact.MarkdownDocumentUnit[] = [];
      for (const [cellIndex, cell] of row.cells.entries()) {
        const cellPath = `${rowPath}/${cellIndex}`;
        const cellUnitId = this.#unitId(cellPath, 'TABLE_CELL');
        const inline = parseInline(cell);
        assertLogicalText(inline.text);
        const blank = inline.text.length === 0;
        if (blank && inline.spans.length > 0) {
          fail(ARTIFACT_MARKDOWN_LOSSY, 'a blank table cell cannot carry inline spans');
        }
        const columnId = columnFacts[cellIndex]?.columnId ?? `md1:c${cellIndex}`;
        const cellUnit: Artifact.MarkdownDocumentUnit = blank
          ? {
              unitId: cellUnitId,
              parentUnitId: rowUnitId,
              unitType: 'TABLE_CELL',
              ordinal: cellIndex,
              childUnitIds: [],
              semanticMetadata: {
                markdown: { columnId, valueState: 'BLANK', inlineSpans: [] },
              },
            }
          : {
              unitId: cellUnitId,
              parentUnitId: rowUnitId,
              unitType: 'TABLE_CELL',
              ordinal: cellIndex,
              text: inline.text,
              childUnitIds: [],
              semanticMetadata: {
                markdown: { columnId, valueState: 'TEXT', inlineSpans: inline.spans },
              },
            };
        this.#record(cellPath, cellUnitId, 'TABLE_CELL', rowUnitId, cellIndex);
        cellUnits.push(cellUnit);
      }
      rowUnits.push(
        {
          unitId: rowUnitId,
          parentUnitId: tableUnitId,
          unitType: 'TABLE_ROW',
          ordinal: rowIndex,
          childUnitIds: cellUnits.map((cell) => cell.unitId),
          semanticMetadata: { markdown: { rowRole: row.header ? 'HEADER' : 'DATA' } },
        },
        ...cellUnits,
      );
      this.#record(rowPath, rowUnitId, 'TABLE_ROW', tableUnitId, rowIndex);
    }

    this.#sourceColumns.push(
      ...columnFacts.map((column) => ({
        tableUnitId,
        columnId: column.columnId,
        ordinal: column.ordinal,
      })),
    );

    const tableUnit: Artifact.MarkdownTableUnit = {
      unitId: tableUnitId,
      ...(parentUnitId === undefined ? {} : { parentUnitId }),
      unitType: 'TABLE',
      ordinal,
      childUnitIds: rowUnits
        .filter((unit) => unit.unitType === 'TABLE_ROW')
        .map((unit) => unit.unitId),
      semanticMetadata: { markdown: { columns: columnFacts, headerRowUnitId } },
    };
    this.#record(path, tableUnitId, 'TABLE', parentUnitId, ordinal);
    return { units: [tableUnit, ...rowUnits], rootIds: [tableUnitId] };
  }
}

// --- public pipeline ------------------------------------------------------

function assertIdentityBinding(
  request: MarkdownParseRequest,
  rawBytesSha256: Common.ContentHash,
): void {
  const map = request.identityMap;
  if (map === undefined) return;

  // A sidecar alone cannot prove which Artifact/Project/output/base or source
  // mapping it belongs to; the owning caller must supply the expected facts.
  const binding = request.identityBinding;
  if (binding === undefined) {
    fail(
      ARTIFACT_MARKDOWN_IDENTITY_INVALID,
      'an authoritative identity sidecar requires the expected owning binding',
    );
  }
  if (!isDeepStrictEqual(map.artifactRef, binding.artifactRef)) {
    fail(
      ARTIFACT_MARKDOWN_IDENTITY_INVALID,
      'identity sidecar artifact reference does not match the expected Artifact and Scope',
    );
  }
  if (binding.artifactRef.scope.enterpriseId !== request.enterpriseId) {
    fail(ARTIFACT_MARKDOWN_IDENTITY_INVALID, 'the expected Artifact is not in this enterprise');
  }
  if (map.candidateOutputId !== request.identityDerivation.candidateOutputId) {
    fail(
      ARTIFACT_MARKDOWN_IDENTITY_INVALID,
      'identity sidecar candidate output does not match the current candidate output',
    );
  }
  if (!isDeepStrictEqual(map.baseRevisionRef, binding.baseRevisionRef)) {
    fail(
      ARTIFACT_MARKDOWN_IDENTITY_INVALID,
      'identity sidecar base revision does not match the expected base',
    );
  }
  if (!isDeepStrictEqual(map.baselineMappingRef, binding.baselineMappingRef)) {
    fail(
      ARTIFACT_MARKDOWN_IDENTITY_INVALID,
      'identity sidecar baseline mapping does not match the expected source mapping',
    );
  }
  if (!isDeepStrictEqual(map.profileRef, markdownDocumentSchemaReference(request.enterpriseId))) {
    fail(
      ARTIFACT_MARKDOWN_IDENTITY_INVALID,
      'identity sidecar profile does not match the registered markdown profile',
    );
  }
  if (map.documentId !== request.documentId) {
    fail(ARTIFACT_MARKDOWN_IDENTITY_INVALID, 'identity sidecar documentId does not match');
  }
  if (
    request.enforceRawBytesBinding !== false &&
    map.markdownBytesSha256.digest !== rawBytesSha256.digest
  ) {
    fail(
      ARTIFACT_MARKDOWN_IDENTITY_INVALID,
      'identity sidecar raw Markdown binding does not match',
    );
  }
}

/** Every declared identity must correspond exactly to one materialized fact. */
function assertSidecarCorrespondence(
  map: Artifact.MarkdownIdentityMap,
  sourceNodes: readonly MarkdownSourceNodeFact[],
  sourceColumns: readonly MarkdownSourceColumnFact[],
): void {
  const declaredByPath = new Map(map.nodes.map((node) => [node.sourceNodePath, node] as const));
  if (declaredByPath.size !== sourceNodes.length || map.nodes.length !== sourceNodes.length) {
    fail(
      ARTIFACT_MARKDOWN_IDENTITY_INVALID,
      'identity sidecar does not cover exactly the parsed units',
    );
  }
  for (const node of sourceNodes) {
    const declared = declaredByPath.get(node.sourceNodePath);
    if (
      declared?.unitId !== node.unitId ||
      declared.type !== node.type ||
      declared.ordinal !== node.ordinal ||
      !isDeepStrictEqual(declared.parentUnitId, node.parentUnitId)
    ) {
      fail(
        ARTIFACT_MARKDOWN_IDENTITY_INVALID,
        `identity sidecar entry for '${node.sourceNodePath}' does not correspond to the parsed unit`,
      );
    }
  }

  const declaredColumns = new Map(
    map.columns.map((column) => [`${column.tableUnitId}#${column.ordinal}`, column] as const),
  );
  if (declaredColumns.size !== map.columns.length || map.columns.length !== sourceColumns.length) {
    fail(
      ARTIFACT_MARKDOWN_IDENTITY_INVALID,
      'identity sidecar does not cover exactly the parsed table columns',
    );
  }
  for (const column of sourceColumns) {
    const declared = declaredColumns.get(`${column.tableUnitId}#${column.ordinal}`);
    if (declared?.columnId !== column.columnId) {
      fail(
        ARTIFACT_MARKDOWN_IDENTITY_INVALID,
        `identity sidecar column for '${column.tableUnitId}#${column.ordinal}' does not correspond to the parsed table`,
      );
    }
  }
}

export function parseMarkdownDocument(request: MarkdownParseRequest): MarkdownParseResult {
  const { text, rawBytesSha256 } = decodeSource(request.bytes);
  assertIdentityBinding(request, rawBytesSha256);

  const lines = text.split('\n');
  const nodes = new BlockScanner(lines, request.now ?? (() => Date.now())).scan();

  const identityByPath =
    request.identityMap === undefined
      ? undefined
      : new Map(request.identityMap.nodes.map((node) => [node.sourceNodePath, node] as const));
  const columnIdentity =
    request.identityMap === undefined
      ? undefined
      : new Map(
          request.identityMap.columns.map(
            (column) => [`${column.tableUnitId}#${column.ordinal}`, column] as const,
          ),
        );

  const materializer = new Materializer({
    derivation: request.identityDerivation,
    identityByPath,
    columnIdentity,
  });
  const units = materializer.materialize(nodes, '', undefined).units;
  if (request.identityMap !== undefined) {
    const mapValidation = registry.validateMarkdownIdentityMap(request.identityMap);
    if (!mapValidation.valid) {
      fail(
        ARTIFACT_MARKDOWN_IDENTITY_INVALID,
        `identity sidecar is not closed: ${mapValidation.errors[0]?.message ?? 'invalid'}`,
      );
    }
    assertSidecarCorrespondence(
      request.identityMap,
      materializer.sourceNodes,
      materializer.sourceColumns,
    );
  }

  const content: Artifact.MarkdownDocumentContent = {
    schemaRef: markdownDocumentSchemaReference(request.enterpriseId),
    contentType: 'STRUCTURED_DOCUMENT',
    canonicalizationVersion: '1',
    body: {
      documentId: request.documentId,
      title: request.title,
      units,
      metadata: request.documentMetadata,
    },
  };

  const validation = registry.validateMarkdownDocumentContent(content);
  if (!validation.valid) {
    const first = validation.errors[0];
    fail(
      ARTIFACT_MARKDOWN_UNSUPPORTED,
      `parsed Markdown document is not canonical-valid: ${first?.instancePath ?? ''} ${first?.message ?? ''}`,
    );
  }

  return {
    content,
    rawBytesSha256,
    contentHash: hashCanonicalContentPayload(sharedPayload(content)),
    canonicalJson: canonicalizeCanonicalContentPayload(sharedPayload(content)),
    sourceNodes: materializer.sourceNodes,
    sourceColumns: materializer.sourceColumns,
    identityDerivation: request.identityDerivation,
    readLimits: markdownDocumentLimits,
  };
}

/**
 * Independent parse/round-trip verification: `parse(render(tree), map) = tree`.
 * Renders bytes are supplied by the IntegrationGateway renderer; any difference
 * rejects the whole file as `ARTIFACT_MARKDOWN_LOSSY`.
 */
export function verifyMarkdownRoundTrip(request: MarkdownRoundTripRequest): MarkdownParseResult {
  const canonical = canonicalizeCanonicalContentPayload(sharedPayload(request.content));
  const reparsed = parseMarkdownDocument({
    bytes: request.renderedBytes,
    enterpriseId: request.enterpriseId,
    documentId: request.content.body.documentId,
    title: request.content.body.title,
    documentMetadata: request.content.body.metadata,
    identityDerivation: request.identityDerivation,
    identityMap: request.identityMap,
    identityBinding: request.identityBinding,
    enforceRawBytesBinding: false,
    ...(request.now === undefined ? {} : { now: request.now }),
  });

  if (canonicalizeCanonicalContentPayload(sharedPayload(reparsed.content)) !== canonical) {
    fail(
      ARTIFACT_MARKDOWN_LOSSY,
      'parse(render(tree)) does not reproduce the canonical Markdown tree',
    );
  }
  if (
    reparsed.contentHash.digest !==
    hashCanonicalContentPayload(sharedPayload(request.content)).digest
  ) {
    fail(ARTIFACT_MARKDOWN_LOSSY, 'round-trip content hash differs from the canonical hash');
  }
  return reparsed;
}
