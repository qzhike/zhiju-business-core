import { SaxesParser } from 'saxes';

import { MVP_INPUT_LIMITS } from '../domain/policy.js';
import { ZipSafetyError, type ScanBudget } from './zip.js';

export interface XmlAttribute {
  readonly uri: string;
  readonly value: string;
}

export interface XmlTag {
  /** 0 for the root element; incremented before a child is reported. */
  readonly depth: number;
  readonly local: string;
  readonly uri: string;
  readonly attributes: Readonly<Record<string, XmlAttribute>>;
}

export interface XmlExpectation {
  readonly roots: readonly { readonly local: string; readonly namespaces: readonly string[] }[];
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function corrupt(): never {
  throw new ZipSafetyError('ZIP_CORRUPT');
}

/**
 * Validate one complete XML stream while only exposing structural events.
 * DOCTYPE, parser errors, altered namespace bindings and unbounded stacks are
 * rejections; entity expansion never happens because external entities are
 * impossible without a DOCTYPE.
 */
export function scanXml(
  bytes: Buffer,
  budget: ScanBudget,
  expectation: XmlExpectation,
  onTag: (tag: XmlTag) => void,
): void {
  // Reserve decoded UTF-16 plus parser token buffers before decoding any XML.
  const xmlBuffers = 4 * bytes.length;
  let metadata = 0;
  const frames: number[] = [];
  const checkMemory = (): void => {
    if (
      budget.retained + 134217728 + budget.transientReserve + xmlBuffers + metadata >
      MVP_INPUT_LIMITS.memoryBytes
    )
      throw new ZipSafetyError('ZIP_LIMIT_EXCEEDED');
  };
  checkMemory();
  let value: string;
  try {
    value = utf8.decode(bytes);
  } catch {
    corrupt();
  }
  const parser = new SaxesParser({ xmlns: true, defaultXMLVersion: '1.0', forceXMLVersion: true });
  let depth = 0;
  parser.on('doctype', corrupt);
  parser.on('error', corrupt);
  parser.on('opentagstart', (tag) => {
    const size = 4096 + 8 * tag.name.length;
    frames.push(size);
    metadata += size;
    checkMemory();
  });
  parser.on('attribute', (attribute) => {
    if (
      (attribute.name === 'xmlns' || attribute.prefix === 'xmlns') &&
      (/[\t\n\r ]/u.test(attribute.value) || attribute.value !== attribute.value.trim())
    )
      corrupt();
    const size = 1024 + 8 * (attribute.name.length + attribute.value.length);
    const current = frames.length - 1;
    frames[current] = (frames[current] ?? 0) + size;
    metadata += size;
    checkMemory();
  });
  parser.on('opentag', (tag) => {
    if (depth === 0) {
      const accepted = expectation.roots.some(
        (root) => root.local === tag.local && root.namespaces.includes(tag.uri),
      );
      if (!accepted) corrupt();
    }
    onTag({
      depth,
      local: tag.local,
      uri: tag.uri,
      attributes: tag.attributes,
    });
    depth++;
  });
  parser.on('closetag', () => {
    depth--;
    metadata -= frames.pop() ?? 0;
  });
  for (let cursor = 0; cursor < value.length; cursor += 16384) {
    if (Date.now() - budget.started > MVP_INPUT_LIMITS.wallClockMs)
      throw new ZipSafetyError('ZIP_LIMIT_EXCEEDED');
    parser.write(value.slice(cursor, cursor + 16384));
  }
  parser.close();
}

export function unqualified(tag: XmlTag, name: string): string | undefined {
  const attribute = tag.attributes[name];
  return attribute?.uri === '' ? attribute.value : undefined;
}

export function qualified(tag: XmlTag, name: string): string | undefined {
  const attribute = tag.attributes[name];
  return attribute === undefined ? undefined : attribute.value;
}
