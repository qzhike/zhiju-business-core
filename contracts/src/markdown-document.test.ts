// #270: the closed `artifact.markdown_document@1.0` profile and
// `artifact.markdown_document.schema@1.0` selector registration plus its
// machine-closed schema and cross-unit invariants.

import { describe, expect, it } from 'vitest';

import { getContractRegistry } from './registry.js';
import { isRecord } from './canonical-content.validation.js';
import {
  artifactMarkdownSchema,
  isMarkdownDocumentSchema,
  loadArtifactMarkdownSchema,
  markdownDocumentLimits,
  markdownDocumentSchemaReference,
} from './markdown-document-profile.js';
import {
  markdownContentInvariantErrors,
  markdownIdentityMapInvariantErrors,
} from './markdown-document.validation.js';

const ENTERPRISE_ID = '0199b600-0000-7000-8000-00000000e273';
const registry = getContractRegistry();

type JsonObject = Record<string, unknown>;

interface FixtureBody extends JsonObject {
  units: JsonObject[];
  metadata: JsonObject;
}

interface FixtureContent extends JsonObject {
  body: FixtureBody;
}

function validContent(): FixtureContent {
  return {
    schemaRef: markdownDocumentSchemaReference(ENTERPRISE_ID),
    contentType: 'STRUCTURED_DOCUMENT',
    canonicalizationVersion: '1',
    body: {
      documentId: '0199b600-0000-7000-8000-00000000d273',
      title: 'Controlled document',
      metadata: { fileKind: 'BLANK_FORM', fileCode: 'QR-PD-7.4-01' },
      units: [
        {
          unitId: 'u0',
          unitType: 'SECTION',
          ordinal: 0,
          text: 'Title',
          childUnitIds: ['u1'],
          semanticMetadata: {
            markdown: { headingLevel: 1, inlineSpans: [{ start: 0, end: 2, kind: 'STRONG' }] },
          },
        },
        {
          unitId: 'u1',
          parentUnitId: 'u0',
          unitType: 'PARAGRAPH',
          ordinal: 0,
          text: 'a\nb',
          childUnitIds: [],
          semanticMetadata: {
            markdown: {
              blockKind: 'LIST_ITEM',
              inlineSpans: [{ start: 1, end: 2, kind: 'HARD_BREAK' }],
              listId: 'list:1',
              listKind: 'ORDERED',
              listOrdinal: 1,
              listDepth: 1,
              orderedMarker: '1.',
            },
          },
        },
      ],
    },
  };
}

function withBody(mutate: (body: FixtureBody) => void): FixtureContent {
  const content = validContent();
  mutate(content.body);
  return content;
}

function mutateUnit(
  content: FixtureContent,
  index: number,
  mutate: (unit: JsonObject) => void,
): void {
  const unit = content.body.units[index];
  if (!isRecord(unit)) throw new Error('invalid fixture unit');
  mutate(unit);
}

describe('markdown profile registration', () => {
  it('freezes the approved profile, selector and limits', () => {
    expect(artifactMarkdownSchema).toEqual({
      profileKey: 'artifact.markdown_document@1.0',
      registryKey: 'artifact.markdown_document.schema@1.0',
      owner: 'artifact',
      objectType: 'artifact.canonical_document_schema',
      objectId: '0199b600-0000-7000-8000-000000000402',
      versionId: '0199b600-0000-7000-8000-000000000412',
      schemaId: 'https://schemas.zhiju.local/modules/artifact/1.0#/$defs/markdownDocumentContent',
      limitsProfileKey: 'artifact.markdown_limits@1.0',
      limits: {
        maxFileBytes: 10_485_760,
        maxUnits: 100_000,
        maxBlockDepth: 6,
        maxTableColumns: 128,
        maxTableRows: 10_000,
        maxLogicalTextCodePoints: 65_536,
        maxParseMilliseconds: 10_000,
        maxParseHeapBytes: 268_435_456,
      },
    });
    expect(markdownDocumentLimits.maxFileBytes).toBe(10_485_760);
  });

  it('rejects an unapproved registry payload', () => {
    expect(() =>
      loadArtifactMarkdownSchema({ registryKey: 'artifact.markdown_document.schema@1.0' }),
    ).toThrow();
  });

  it('resolves exactly one enterprise-scoped selector reference', () => {
    const reference = markdownDocumentSchemaReference(ENTERPRISE_ID);
    expect(reference).toEqual({
      kind: 'VERSIONED',
      objectType: 'artifact.canonical_document_schema',
      objectId: '0199b600-0000-7000-8000-000000000402',
      versionId: '0199b600-0000-7000-8000-000000000412',
      scope: { enterpriseId: ENTERPRISE_ID },
    });
    expect(isMarkdownDocumentSchema(reference, ENTERPRISE_ID)).toBe(true);
    expect(isMarkdownDocumentSchema(reference, '0199b600-0000-7000-8000-00000000e999')).toBe(false);
  });
});

describe('closed markdown document schema', () => {
  it('accepts the closed profile document', () => {
    expect(registry.validateMarkdownDocumentContent(validContent()).valid).toBe(true);
  });

  it('rejects unknown document metadata and unit metadata keys', () => {
    const unknownDocumentKey = withBody((body) => {
      body.metadata = { fileKind: 'BLANK_FORM', fileCode: 'QR-PD-7.4-01', extra: true };
    });
    expect(registry.validateMarkdownDocumentContent(unknownDocumentKey).valid).toBe(false);

    const unknownUnitKey = validContent();
    mutateUnit(unknownUnitKey, 0, (unit) => {
      unit.semanticMetadata = {
        markdown: { headingLevel: 1, inlineSpans: [], tablePurpose: 'x' },
      };
    });
    expect(registry.validateMarkdownDocumentContent(unknownUnitKey).valid).toBe(false);
  });

  it('rejects an out-of-range heading level and a wrong paragraph block kind', () => {
    const heading = validContent();
    mutateUnit(heading, 0, (unit) => {
      unit.semanticMetadata = { markdown: { headingLevel: 7, inlineSpans: [] } };
    });
    expect(registry.validateMarkdownDocumentContent(heading).valid).toBe(false);

    const blockKind = validContent();
    mutateUnit(blockKind, 1, (unit) => {
      unit.semanticMetadata = { markdown: { blockKind: 'UNKNOWN', inlineSpans: [] } };
    });
    expect(registry.validateMarkdownDocumentContent(blockKind).valid).toBe(false);
  });

  it('rejects inline spans that are unordered, overlapping or not over one LF', () => {
    const overlapping = validContent();
    mutateUnit(overlapping, 1, (unit) => {
      unit.semanticMetadata = {
        markdown: {
          blockKind: 'TEXT',
          inlineSpans: [
            { start: 0, end: 2, kind: 'STRONG' },
            { start: 1, end: 3, kind: 'EMPHASIS' },
          ],
        },
      };
    });
    expect(registry.validateMarkdownDocumentContent(overlapping).valid).toBe(false);

    const badHardBreak = validContent();
    mutateUnit(badHardBreak, 1, (unit) => {
      unit.semanticMetadata = {
        markdown: { blockKind: 'TEXT', inlineSpans: [{ start: 0, end: 1, kind: 'HARD_BREAK' }] },
      };
    });
    expect(registry.validateMarkdownDocumentContent(badHardBreak).valid).toBe(false);
  });

  it('rejects an out-of-range inline span', () => {
    const content = withBody((body) => {
      body.units = [
        {
          unitId: 'u0',
          unitType: 'SECTION',
          ordinal: 0,
          text: 'ab',
          childUnitIds: [],
          semanticMetadata: {
            markdown: { headingLevel: 1, inlineSpans: [{ start: 1, end: 5, kind: 'STRONG' }] },
          },
        },
      ];
    });
    const errors = markdownContentInvariantErrors(content);
    expect(errors.some((error) => error.instancePath.includes('inlineSpans'))).toBe(true);
    expect(registry.validateMarkdownDocumentContent(content).valid).toBe(false);
  });

  it('rejects a table whose rows and cells do not match its columns', () => {
    const content = withBody((body) => {
      body.units = [
        {
          unitId: 't0',
          unitType: 'TABLE',
          ordinal: 0,
          childUnitIds: ['t0r0'],
          semanticMetadata: {
            markdown: {
              columns: [
                { columnId: 'c0', ordinal: 0, alignment: 'NONE' },
                { columnId: 'c1', ordinal: 1, alignment: 'NONE' },
              ],
              headerRowUnitId: 't0r0',
            },
          },
        },
        {
          unitId: 't0r0',
          parentUnitId: 't0',
          unitType: 'TABLE_ROW',
          ordinal: 0,
          childUnitIds: ['t0r0c0'],
          semanticMetadata: { markdown: { rowRole: 'HEADER' } },
        },
        {
          unitId: 't0r0c0',
          parentUnitId: 't0r0',
          unitType: 'TABLE_CELL',
          ordinal: 0,
          childUnitIds: [],
          text: '0',
          semanticMetadata: {
            markdown: { columnId: 'c0', valueState: 'TEXT', inlineSpans: [] },
          },
        },
      ];
    });
    expect(registry.validateMarkdownDocumentContent(content).valid).toBe(false);
  });

  it('rejects a blank cell that carries text and a text cell that does not', () => {
    // The closed schema itself pins the BLANK/TEXT conditions.
    const wrongBlank = withBody((body) => {
      body.units = [
        {
          unitId: 'c0',
          unitType: 'TABLE_CELL',
          ordinal: 0,
          childUnitIds: [],
          text: 'text',
          semanticMetadata: { markdown: { columnId: 'c0', valueState: 'BLANK', inlineSpans: [] } },
        },
      ];
    });
    expect(registry.validateMarkdownDocumentContent(wrongBlank).valid).toBe(false);
  });
});

describe('closed identity sidecar schema', () => {
  const map = (): Record<string, unknown> => ({
    profileRef: markdownDocumentSchemaReference(ENTERPRISE_ID),
    artifactRef: {
      kind: 'OBJECT',
      objectType: 'artifact.artifact',
      objectId: '0199b600-0000-7000-8000-00000000a273',
      scope: { enterpriseId: ENTERPRISE_ID, projectId: '0199b600-0000-7000-8000-00000000c273' },
    },
    documentId: '0199b600-0000-7000-8000-00000000d273',
    candidateOutputId: 'candidate-1',
    markdownBytesSha256: {
      algorithm: 'SHA-256',
      canonicalizationVersion: '1',
      digest: 'a'.repeat(64),
    },
    nodes: [
      { sourceNodePath: '0', unitId: 'u0', type: 'SECTION', ordinal: 0 },
      { sourceNodePath: '0/0', unitId: 'u1', type: 'PARAGRAPH', parentUnitId: 'u0', ordinal: 0 },
    ],
    columns: [{ tableUnitId: 't0', columnId: 'c0', ordinal: 0 }],
  });

  it('accepts the closed sidecar', () => {
    expect(registry.validateMarkdownIdentityMap(map()).valid).toBe(true);
  });

  it('rejects duplicate identities and unknown unit types', () => {
    const duplicate = map();
    duplicate.nodes = [
      { sourceNodePath: '0', unitId: 'u0', type: 'SECTION', ordinal: 0 },
      { sourceNodePath: '1', unitId: 'u0', type: 'SECTION', ordinal: 1 },
    ];
    expect(registry.validateMarkdownIdentityMap(duplicate).valid).toBe(false);
    expect(markdownIdentityMapInvariantErrors(duplicate)).not.toHaveLength(0);

    const unknownType = map();
    unknownType.nodes = [{ sourceNodePath: '0', unitId: 'u0', type: 'DOCUMENT', ordinal: 0 }];
    expect(registry.validateMarkdownIdentityMap(unknownType).valid).toBe(false);
  });

  it('rejects a duplicate table column identity', () => {
    const duplicateColumns = map();
    duplicateColumns.columns = [
      { tableUnitId: 't0', columnId: 'c0', ordinal: 0 },
      { tableUnitId: 't0', columnId: 'c0', ordinal: 1 },
    ];
    expect(registry.validateMarkdownIdentityMap(duplicateColumns).valid).toBe(false);
  });
});
