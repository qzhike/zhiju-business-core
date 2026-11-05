import { MEDIA_TYPES } from '../domain/policy.js';
import { scanXml, type XmlTag } from '../custody/xml.js';
import { createScanBudget, parseZipContainer, checkScanMemory } from '../custody/zip.js';
import { PREVIEW_LIMITS as limits, PreviewFailure, previewLimit } from './profile.js';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STRICT = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOCUMENT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function attribute(tag: XmlTag, uri: string, local: string): string | undefined {
  return Object.values(tag.attributes).find((value) => value.uri === uri && value.local === local)
    ?.value;
}

function expectation(path: string) {
  if (path === 'word/document.xml')
    return { roots: [{ local: 'document', namespaces: [WORD, STRICT] }] };
  if (path === 'word/styles.xml') return { roots: [{ local: 'styles', namespaces: [WORD] }] };
  if (path === 'word/numbering.xml') return { roots: [{ local: 'numbering', namespaces: [WORD] }] };
  if (path === 'word/_rels/document.xml.rels')
    return { roots: [{ local: 'Relationships', namespaces: [REL] }] };
  if (path.startsWith('word/header') && path.endsWith('.xml'))
    return { roots: [{ local: 'hdr', namespaces: [WORD] }] };
  if (path.startsWith('word/footer') && path.endsWith('.xml'))
    return { roots: [{ local: 'ftr', namespaces: [WORD] }] };
  if (path === 'word/comments.xml') return { roots: [{ local: 'comments', namespaces: [WORD] }] };
  if (path.startsWith('word/comments') && path.endsWith('.xml'))
    return {
      roots: [
        {
          local: 'commentsEx',
          namespaces: ['http://schemas.microsoft.com/office/word/2012/wordml'],
        },
        {
          local: 'commentsIds',
          namespaces: ['http://schemas.microsoft.com/office/word/2016/wordml/cid'],
        },
        {
          local: 'commentsExtensible',
          namespaces: ['http://schemas.microsoft.com/office/word/2018/wordml/cex'],
        },
      ],
    };
  return undefined;
}

/** Bound the pinned reader's tree and repeated strings before Python allocation. */
export function preflightPreview(bytes: Buffer, mediaType: string): void {
  previewLimit(bytes.length, limits.sourceBytes);
  if (mediaType === MEDIA_TYPES.markdown) {
    const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!source.trim()) throw new PreviewFailure('EMPTY_CONTENT');
    previewLimit(6 * bytes.length + 4096, limits.outputBytes);
    return;
  }
  if (mediaType !== MEDIA_TYPES.docx) throw new PreviewFailure('FORMAT_NOT_SUPPORTED');
  const budget = createScanBudget(bytes.length);
  budget.limits = { EXPANDED_BYTES: limits.expandedBytes, PROCESSING_TIME_MS: limits.timeMs };
  const entries = parseZipContainer(bytes, budget, 'OFFICE');
  previewLimit(entries.length, limits.parts);
  if (!entries.some((entry) => entry.originalName === 'word/document.xml'))
    throw new PreviewFailure('UNSAFE_CONTENT');
  let nodes = 0;
  let paragraphs = 0;
  let weightedText = 0;
  let attributes = 0;
  let longestAttribute = 0;
  let objects = 0;
  let gridColumns = 0;
  const commentReferences = new Map<string, number>();
  const commentCopies = new Map<string, number>();
  const hyperlinkReferences = new Map<string, number>();
  const relationshipBytes = new Map<string, number>();
  let anchorEntries = 0;
  for (const entry of entries) {
    if (entry.originalName !== entry.normalizedPath) throw new PreviewFailure('UNSAFE_CONTENT');
    // Inventory/header/comment metadata copies part names, including non-XML media.
    objects += 256 + 6 * Buffer.byteLength(entry.originalName);
    const expected = expectation(entry.originalName);
    if (expected === undefined) continue;
    previewLimit(entry.bytes.length, limits.xmlBytes);
    const stack: XmlTag[] = [];
    const accountText = (size: number): void => {
      const ancestors = (names: readonly string[]) =>
        stack.filter((tag) => tag.uri === WORD && names.includes(tag.local)).length;
      // Each cell/comment walks every descendant paragraph; nested shapes multiply.
      const copies =
        2 +
        ancestors(['p']) * (1 + ancestors(['tc', 'comment'])) +
        ancestors(['comment', 'ins', 'del', 'moveFrom', 'moveTo', 'fldSimple', 'hyperlink']);
      weightedText += size * copies;
      previewLimit(weightedText * 6 + objects + attributes * 6, limits.outputBytes);
    };
    scanXml(
      entry.bytes,
      budget,
      expected,
      (tag) => {
        nodes++;
        previewLimit(nodes, limits.nodes);
        previewLimit(tag.depth + 1, limits.depth);
        if (tag.uri === STRICT) throw new PreviewFailure('FORMAT_NOT_SUPPORTED');
        if (tag.uri === WORD && tag.local === 'tbl') {
          if (stack.some((parent) => parent.uri === WORD && parent.local === 'tbl'))
            throw new PreviewFailure('NESTED_TABLE_NOT_SUPPORTED');
          gridColumns = 0;
        }
        if (tag.uri === WORD && tag.local === 'gridCol') {
          gridColumns++;
          previewLimit(gridColumns, 512);
        }
        if (tag.uri === WORD && tag.local === 'gridSpan') {
          const span = Object.values(tag.attributes).find(
            (value) => value.local === 'val' && value.uri === WORD,
          )?.value;
          if (span === undefined || !/^[1-9][0-9]{0,2}$/u.test(span) || Number(span) > gridColumns)
            throw new PreviewFailure('UNSAFE_CONTENT');
        }
        if (tag.uri === WORD && tag.local === 'p') paragraphs++;
        if (
          entry.originalName === 'word/document.xml' &&
          tag.uri === WORD &&
          ['commentReference', 'commentRangeStart'].includes(tag.local)
        ) {
          const id = attribute(tag, WORD, 'id');
          const copies = stack.filter(
            (parent) => parent.uri === WORD && parent.local === 'p',
          ).length;
          if (id !== undefined) {
            commentReferences.set(id, (commentReferences.get(id) ?? 0) + copies);
            anchorEntries += copies;
          }
        }
        if (
          entry.originalName === 'word/comments.xml' &&
          tag.uri === WORD &&
          tag.local === 'comment'
        ) {
          const id = attribute(tag, WORD, 'id') ?? '';
          commentCopies.set(id, (commentCopies.get(id) ?? 0) + 1);
        }
        if (
          entry.originalName === 'word/document.xml' &&
          tag.uri === WORD &&
          tag.local === 'hyperlink'
        ) {
          const id = attribute(tag, DOCUMENT_REL, 'id');
          if (id !== undefined) hyperlinkReferences.set(id, (hyperlinkReferences.get(id) ?? 0) + 1);
        }
        if (entry.originalName === 'word/_rels/document.xml.rels' && tag.depth === 1) {
          const id = attribute(tag, '', 'Id');
          if (id)
            relationshipBytes.set(
              id,
              256 +
                6 *
                  ['Target', 'Type', 'TargetMode'].reduce(
                    (total, name) => total + Buffer.byteLength(attribute(tag, '', name) ?? ''),
                    0,
                  ),
            );
        }
        if (tag.uri === WORD && ['instrText', 'fldSimple'].includes(tag.local))
          objects += 6 * Buffer.byteLength(entry.originalName);
        for (const attribute of Object.values(tag.attributes)) {
          const size = Buffer.byteLength(attribute.value);
          attributes += size + Buffer.byteLength(attribute.local);
          if (
            attribute.uri === WORD &&
            (['word/numbering.xml', 'word/styles.xml'].includes(entry.originalName) ||
              (tag.uri === WORD && ['numId', 'ilvl', 'pStyle'].includes(tag.local)))
          )
            longestAttribute = Math.max(longestAttribute, size);
          objects += 32;
        }
        // This includes metadata and attributes the reader may copy into dictionaries.
        objects += 256 + 6 * Buffer.byteLength(tag.local);
        stack.push(tag);
        // _text also creates characters for empty Word control elements.
        if (tag.uri === WORD && ['tab', 'br', 'cr'].includes(tag.local)) accountText(1);
        checkScanMemory(
          budget,
          4096 * nodes + 8 * weightedText + 8 * attributes + 8 * objects + 64 * anchorEntries,
        );
      },
      {
        close: () => {
          stack.pop();
        },
        text: (text) => {
          accountText(Buffer.byteLength(text));
        },
      },
    );
  }
  // The collector copies each id's anchor array and relationship into every reference.
  let referencedOutput = 0;
  for (const [id, copies] of commentCopies)
    referencedOutput += 32 * copies * (commentReferences.get(id) ?? 0);
  for (const [id, copies] of hyperlinkReferences)
    referencedOutput += copies * (relationshipBytes.get(id) ?? 0);
  // Numbering values are reproduced in each paragraph's JSON and readable prefix.
  const outputBound =
    65536 +
    objects +
    6 * (weightedText + attributes) +
    paragraphs * (1024 + 36 * longestAttribute) +
    referencedOutput;
  previewLimit(outputBound, limits.outputBytes);
  checkScanMemory(
    budget,
    4096 * nodes +
      8 * weightedText +
      8 * attributes +
      8 * objects +
      64 * anchorEntries +
      4 * outputBound,
  );
}
