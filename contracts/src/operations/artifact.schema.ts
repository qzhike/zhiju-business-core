import type { JsonSchema } from '../schema-types.js';

const schemaId = 'https://schemas.zhiju.local/modules/artifact/1.0';
const common = 'https://schemas.zhiju.local/common/1.0#/$defs/';

export const artifactCanonicalContentPayloadSchemaRef = `${schemaId}#/$defs/canonicalContentPayload`;
export const artifactCanonicalContentManifestSchemaRef = `${schemaId}#/$defs/canonicalContentManifest`;
// #270 closed Markdown document profile ($defs registered by
// contracts/registry/artifact-markdown-schemas.v1.json as
// `artifact.markdown_document.schema@1.0`).
export const artifactMarkdownDocumentContentSchemaRef = `${schemaId}#/$defs/markdownDocumentContent`;
export const artifactMarkdownIdentityMapSchemaRef = `${schemaId}#/$defs/markdownIdentityMap`;

type SchemaProperties = Readonly<Record<string, unknown>>;

interface OperationContractSchema {
  readonly payload: JsonSchema;
  readonly result?: JsonSchema;
}

export interface ExecutableArtifactOperationContract {
  readonly payloadSchemaRef: string;
  readonly resultSchemaRef?: string;
}

function object(
  required: readonly string[],
  properties: SchemaProperties,
  allOf?: readonly unknown[],
): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
    ...(allOf === undefined ? {} : { allOf: allOf as unknown[] }),
  };
}

function array(
  items: unknown,
  options: { readonly nonEmpty?: boolean; readonly unique?: boolean } = {},
) {
  return {
    type: 'array',
    items,
    ...(options.nonEmpty === true ? { minItems: 1 } : {}),
    ...(options.unique === true ? { uniqueItems: true } : {}),
  } as const;
}

function localRef(name: string) {
  return { $ref: `${schemaId}#/$defs/${name}` } as const;
}

const uuid = { $ref: `${common}uuidV7` } as const;
const namespace = { $ref: `${common}namespaceCode` } as const;
const reasonCode = { $ref: `${common}reasonCode` } as const;
const text = { $ref: `${common}nonEmptyString` } as const;
const instant = { $ref: `${common}utcInstant` } as const;
const positiveInteger = { $ref: `${common}positiveInteger` } as const;
const nonNegativeInteger = { $ref: `${common}nonNegativeInteger` } as const;
const contentHash = { $ref: `${common}contentHash` } as const;
const scope = { $ref: `${common}scopeRef` } as const;
const objectReference = { $ref: `${common}objectRef` } as const;
const versionedReference = { $ref: `${common}versionedRef` } as const;
const typedReference = { $ref: `${common}typedReference` } as const;
const contentAddressedReference = { $ref: `${common}contentAddressedRef` } as const;
const snapshotReference = { $ref: `${common}snapshotRef` } as const;
const canonicalJson = {} as const;

const namedDefinitions = {
  executionRevisionContent: {
    type: 'object',
    additionalProperties: false,
    required: [
      'artifactRef',
      'branchId',
      'parentRevisionRefs',
      'contentType',
      'contentRef',
      'contentHash',
      'structureSchemaRef',
      'semanticMetadata',
      'changedUnits',
      'changeSummary',
    ],
    properties: {
      artifactRef: {
        allOf: [
          {
            $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/objectRef',
          },
          {
            type: 'object',
            properties: {
              objectType: {
                const: 'artifact.artifact',
              },
              scope: {
                type: 'object',
                required: ['enterpriseId', 'projectId'],
                properties: {
                  enterpriseId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                  projectId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                },
              },
            },
          },
        ],
      },
      branchId: {
        $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
      },
      parentRevisionRefs: {
        type: 'array',
        items: {
          $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/contentAddressedRef',
        },
        maxItems: 0,
      },
      contentType: {
        const: 'STRUCTURED_DOCUMENT',
      },
      contentRef: {
        $ref: 'https://schemas.zhiju.local/modules/artifact/1.0#/$defs/objectLocator',
      },
      contentHash: {
        $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/contentHash',
      },
      structureSchemaRef: {
        $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/versionedRef',
      },
      semanticMetadata: {
        type: 'object',
        additionalProperties: false,
        required: [],
        properties: {},
      },
      changedUnits: {
        type: 'array',
        items: {
          $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/nonEmptyString',
        },
        minItems: 1,
        uniqueItems: true,
      },
      changeSummary: {
        $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/nonEmptyString',
      },
    },
  },
  executionRevisionCreationReceipt: {
    type: 'object',
    additionalProperties: false,
    required: [
      'commandId',
      'commandType',
      'commandVersion',
      'targetRef',
      'scopeRef',
      'requestPayloadHash',
      'outcome',
      'revisionRef',
      'actorRef',
      'actorSnapshotRef',
      'authorizationDecisionRef',
      'committedAt',
    ],
    properties: {
      commandId: {
        $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
      },
      commandType: {
        const: 'artifact.create_execution_revision',
      },
      commandVersion: {
        const: '1.0',
      },
      targetRef: {
        allOf: [
          {
            $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/objectRef',
          },
          {
            type: 'object',
            properties: {
              objectType: {
                const: 'artifact.artifact_revision',
              },
              scope: {
                type: 'object',
                required: ['enterpriseId', 'projectId'],
                properties: {
                  enterpriseId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                  projectId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                },
              },
            },
          },
        ],
      },
      scopeRef: {
        $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/scopeRef',
      },
      requestPayloadHash: {
        $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/contentHash',
      },
      outcome: {
        const: 'COMMITTED',
      },
      revisionRef: {
        allOf: [
          {
            $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/contentAddressedRef',
          },
          {
            type: 'object',
            properties: {
              objectType: {
                const: 'artifact.artifact_revision',
              },
              scope: {
                type: 'object',
                required: ['enterpriseId', 'projectId'],
                properties: {
                  enterpriseId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                  projectId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                },
              },
            },
          },
        ],
      },
      actorRef: {
        $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/objectRef',
      },
      actorSnapshotRef: {
        $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/snapshotRef',
      },
      authorizationDecisionRef: {
        $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/contentAddressedRef',
      },
      committedAt: {
        $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/utcInstant',
      },
    },
  },
  executionRevisionCreationBinding: {
    type: 'object',
    additionalProperties: false,
    required: [
      'revisionRef',
      'creationCommandRef',
      'taskRef',
      'workOrderRef',
      'runRef',
      'workOrderContractRef',
      'contextSnapshotRef',
      'controlsPolicyRef',
      'observedRunVersion',
      'startedAt',
      'bindingObservedAt',
      'bindingValidUntil',
      'bindingObservationHash',
      'createdAt',
    ],
    properties: {
      revisionRef: {
        allOf: [
          {
            $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/contentAddressedRef',
          },
          {
            type: 'object',
            properties: {
              objectType: {
                const: 'artifact.artifact_revision',
              },
              scope: {
                type: 'object',
                required: ['enterpriseId', 'projectId'],
                properties: {
                  enterpriseId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                  projectId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                },
              },
            },
          },
        ],
      },
      creationCommandRef: {
        allOf: [
          {
            $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/contentAddressedRef',
          },
          {
            type: 'object',
            properties: {
              objectType: {
                const: 'zhiju.artifact.command_receipt',
              },
              scope: {
                type: 'object',
                required: ['enterpriseId', 'projectId'],
                properties: {
                  enterpriseId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                  projectId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                },
              },
            },
          },
        ],
      },
      taskRef: {
        allOf: [
          {
            $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/objectRef',
          },
          {
            type: 'object',
            properties: {
              objectType: {
                const: 'zhiju.execution.task',
              },
              scope: {
                type: 'object',
                required: ['enterpriseId', 'projectId'],
                properties: {
                  enterpriseId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                  projectId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                },
              },
            },
          },
        ],
      },
      workOrderRef: {
        allOf: [
          {
            $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/objectRef',
          },
          {
            type: 'object',
            properties: {
              objectType: {
                const: 'zhiju.execution.work_order',
              },
              scope: {
                type: 'object',
                required: ['enterpriseId', 'projectId'],
                properties: {
                  enterpriseId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                  projectId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                },
              },
            },
          },
        ],
      },
      runRef: {
        allOf: [
          {
            $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/objectRef',
          },
          {
            type: 'object',
            properties: {
              objectType: {
                const: 'execution.run',
              },
              scope: {
                type: 'object',
                required: ['enterpriseId', 'projectId'],
                properties: {
                  enterpriseId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                  projectId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                },
              },
            },
          },
        ],
      },
      workOrderContractRef: {
        allOf: [
          {
            $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/contentAddressedRef',
          },
          {
            type: 'object',
            properties: {
              objectType: {
                const: 'zhiju.contract.work_order',
              },
              scope: {
                type: 'object',
                required: ['enterpriseId', 'projectId'],
                properties: {
                  enterpriseId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                  projectId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                },
              },
            },
          },
        ],
      },
      contextSnapshotRef: {
        allOf: [
          {
            $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/snapshotRef',
          },
          {
            type: 'object',
            properties: {
              objectType: {
                const: 'zhiju.execution.context_snapshot',
              },
              scope: {
                type: 'object',
                required: ['enterpriseId', 'projectId'],
                properties: {
                  enterpriseId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                  projectId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                },
              },
            },
          },
        ],
      },
      controlsPolicyRef: {
        allOf: [
          {
            $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/versionedRef',
          },
          {
            type: 'object',
            properties: {
              objectType: {
                const: 'zhiju.identity.policy',
              },
              scope: {
                type: 'object',
                required: ['enterpriseId', 'projectId'],
                properties: {
                  enterpriseId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                  projectId: {
                    $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                  },
                },
              },
            },
          },
        ],
      },
      observedRunVersion: {
        $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/nonNegativeInteger',
      },
      startedAt: {
        $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/utcInstant',
      },
      bindingObservedAt: {
        $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/utcInstant',
      },
      bindingValidUntil: {
        $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/utcInstant',
      },
      bindingObservationHash: {
        $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/contentHash',
      },
      createdAt: {
        $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/utcInstant',
      },
    },
  },
  artifactScope: { enum: ['PROJECT_DELIVERABLE', 'ENTERPRISE_CONTROLLED'] },
  artifactLifecycle: { enum: ['ACTIVE', 'ARCHIVED', 'CANCELLED'] },
  revisionDisposition: { enum: ['ACTIVE', 'SUPERSEDED', 'WITHDRAWN', 'INVALIDATED'] },
  contentType: {
    enum: ['STRUCTURED_DOCUMENT', 'WORKBOOK_SPEC', 'STRUCTURED_REPORT', 'OPAQUE_IMPORTED_CONTENT'],
  },
  canonicalContentType: { enum: ['STRUCTURED_DOCUMENT', 'WORKBOOK_SPEC'] },
  canonicalDocumentUnit: object(['unitId', 'unitType', 'ordinal', 'childUnitIds'], {
    unitId: text,
    parentUnitId: text,
    unitType: { enum: ['SECTION', 'PARAGRAPH', 'TABLE', 'TABLE_ROW', 'TABLE_CELL'] },
    ordinal: nonNegativeInteger,
    text,
    childUnitIds: array(text, { unique: true }),
    semanticMetadata: canonicalJson,
    evidenceRefs: array(contentAddressedReference, { unique: true }),
  }),
  canonicalDocument: object(['documentId', 'title', 'units'], {
    documentId: uuid,
    title: text,
    units: array(localRef('canonicalDocumentUnit'), { nonEmpty: true }),
    metadata: canonicalJson,
  }),
  canonicalWorkbookColumn: object(['columnId', 'name', 'ordinal', 'valueType'], {
    columnId: text,
    name: text,
    ordinal: nonNegativeInteger,
    valueType: namespace,
  }),
  canonicalWorkbookCell: object(['cellId', 'columnId', 'valueType'], {
    cellId: text,
    columnId: text,
    value: canonicalJson,
    valueType: namespace,
    formula: {
      type: 'string',
      minLength: 2,
      pattern: '^=[^\\u0000-\\u001F\\u007F]+$',
    },
  }),
  canonicalWorkbookRow: object(['rowId', 'ordinal', 'cells'], {
    rowId: text,
    ordinal: nonNegativeInteger,
    cells: array(localRef('canonicalWorkbookCell')),
  }),
  canonicalWorkbookSheet: object(['sheetId', 'name', 'ordinal', 'columns', 'rows'], {
    sheetId: text,
    name: text,
    ordinal: nonNegativeInteger,
    columns: array(localRef('canonicalWorkbookColumn')),
    rows: array(localRef('canonicalWorkbookRow')),
    validationRules: array(canonicalJson),
    crossRecordRules: array(canonicalJson),
  }),
  canonicalWorkbookSpec: object(['workbookId', 'sheets'], {
    workbookId: uuid,
    sheets: array(localRef('canonicalWorkbookSheet'), { nonEmpty: true }),
    metadata: canonicalJson,
  }),
  canonicalDocumentContent: object(
    ['schemaRef', 'contentType', 'canonicalizationVersion', 'body'],
    {
      schemaRef: versionedReference,
      contentType: { const: 'STRUCTURED_DOCUMENT' },
      canonicalizationVersion: { const: '1' },
      body: localRef('canonicalDocument'),
    },
  ),
  canonicalWorkbookContent: object(
    ['schemaRef', 'contentType', 'canonicalizationVersion', 'body'],
    {
      schemaRef: versionedReference,
      contentType: { const: 'WORKBOOK_SPEC' },
      canonicalizationVersion: { const: '1' },
      body: localRef('canonicalWorkbookSpec'),
    },
  ),
  canonicalContentPayload: {
    oneOf: [localRef('canonicalDocumentContent'), localRef('canonicalWorkbookContent')],
  },
  canonicalContentManifest: object(
    [
      'contentObjectId',
      'payloadSchemaRef',
      'contentType',
      'canonicalizationVersion',
      'contentHash',
      'byteSize',
      'mediaType',
      'objectRef',
      'storageState',
    ],
    {
      contentObjectId: uuid,
      payloadSchemaRef: versionedReference,
      contentType: localRef('canonicalContentType'),
      canonicalizationVersion: { const: '1' },
      contentHash,
      byteSize: nonNegativeInteger,
      mediaType: localRef('mediaType'),
      objectRef: localRef('objectLocator'),
      storageState: { enum: ['STAGING', 'LINKED', 'FROZEN', 'QUARANTINED'] },
    },
  ),
  // Opaque controlled-object-storage locator: bucket-or-container plus key segments.
  // A public URL, a scheme prefix and an absolute local path are all rejected.
  objectLocator: {
    type: 'string',
    pattern: '^[a-z0-9][a-z0-9._-]*(?:/[A-Za-z0-9._-]+)+$',
  },
  mediaType: { type: 'string', pattern: '^[^/\\s]+/[^/\\s]+$' },
  // --- #270 Markdown document profile (artifact.markdown_document.schema@1.0) ---
  // Closed inline span over logical Unicode code points; STRONG/EMPHASIS may
  // share one interval, every other overlap/crossing is rejected by the
  // markdown document invariant validator.
  markdownInlineSpan: object(['start', 'end', 'kind'], {
    start: nonNegativeInteger,
    end: positiveInteger,
    kind: { enum: ['STRONG', 'EMPHASIS', 'CODE', 'HARD_BREAK'] },
  }),
  markdownInlineSpans: array(localRef('markdownInlineSpan')),
  markdownSectionMetadata: object(['markdown'], {
    markdown: object(['headingLevel', 'inlineSpans'], {
      headingLevel: { type: 'integer', minimum: 1, maximum: 6 },
      inlineSpans: localRef('markdownInlineSpans'),
    }),
  }),
  markdownParagraphTextMetadata: object(['markdown'], {
    markdown: object(['blockKind', 'inlineSpans'], {
      blockKind: { const: 'TEXT' },
      inlineSpans: localRef('markdownInlineSpans'),
    }),
  }),
  markdownListItemMetadata: object(['markdown'], {
    markdown: object(
      ['blockKind', 'inlineSpans', 'listId', 'listKind', 'listOrdinal', 'listDepth'],
      {
        blockKind: { const: 'LIST_ITEM' },
        inlineSpans: localRef('markdownInlineSpans'),
        listId: text,
        listKind: { enum: ['ORDERED', 'UNORDERED'] },
        listOrdinal: nonNegativeInteger,
        listDepth: { type: 'integer', minimum: 1, maximum: 6 },
        orderedMarker: text,
      },
    ),
  }),
  markdownThematicBreakMetadata: object(['markdown'], {
    markdown: object(['blockKind'], { blockKind: { const: 'THEMATIC_BREAK' } }),
  }),
  markdownTableColumn: object(['columnId', 'ordinal', 'alignment'], {
    columnId: text,
    ordinal: nonNegativeInteger,
    alignment: { enum: ['NONE', 'LEFT', 'CENTER', 'RIGHT'] },
  }),
  markdownTableMetadata: object(['markdown'], {
    markdown: object(['columns', 'headerRowUnitId'], {
      columns: array(localRef('markdownTableColumn'), { nonEmpty: true }),
      headerRowUnitId: text,
      captionUnitId: text,
    }),
  }),
  markdownTableRowMetadata: object(['markdown'], {
    markdown: object(['rowRole'], { rowRole: { enum: ['HEADER', 'DATA'] } }),
  }),
  markdownBlankTableCellMetadata: object(['markdown'], {
    markdown: object(['columnId', 'valueState', 'inlineSpans'], {
      columnId: text,
      valueState: { const: 'BLANK' },
      inlineSpans: { type: 'array', maxItems: 0 },
    }),
  }),
  markdownTextTableCellMetadata: object(['markdown'], {
    markdown: object(['columnId', 'valueState', 'inlineSpans'], {
      columnId: text,
      valueState: { const: 'TEXT' },
      inlineSpans: localRef('markdownInlineSpans'),
    }),
  }),
  markdownDocumentMetadata: object(['fileKind', 'fileCode'], {
    fileKind: { enum: ['PROCEDURE', 'MANUAL', 'POLICY', 'BLANK_FORM', 'FILLED_RECORD'] },
    fileCode: text,
    templateVersionText: text,
  }),
  markdownSectionUnit: object(
    ['unitId', 'unitType', 'ordinal', 'childUnitIds', 'text', 'semanticMetadata'],
    {
      unitId: text,
      parentUnitId: text,
      unitType: { const: 'SECTION' },
      ordinal: nonNegativeInteger,
      text,
      childUnitIds: array(text, { unique: true }),
      semanticMetadata: localRef('markdownSectionMetadata'),
      evidenceRefs: array(contentAddressedReference, { unique: true }),
    },
  ),
  markdownParagraphTextUnit: object(
    ['unitId', 'unitType', 'ordinal', 'childUnitIds', 'text', 'semanticMetadata'],
    {
      unitId: text,
      parentUnitId: text,
      unitType: { const: 'PARAGRAPH' },
      ordinal: nonNegativeInteger,
      text,
      childUnitIds: array(text, { unique: true }),
      semanticMetadata: localRef('markdownParagraphTextMetadata'),
      evidenceRefs: array(contentAddressedReference, { unique: true }),
    },
  ),
  markdownListItemUnit: object(
    ['unitId', 'unitType', 'ordinal', 'childUnitIds', 'text', 'semanticMetadata'],
    {
      unitId: text,
      parentUnitId: text,
      unitType: { const: 'PARAGRAPH' },
      ordinal: nonNegativeInteger,
      text,
      childUnitIds: array(text, { unique: true }),
      semanticMetadata: localRef('markdownListItemMetadata'),
      evidenceRefs: array(contentAddressedReference, { unique: true }),
    },
  ),
  markdownThematicBreakUnit: object(
    ['unitId', 'unitType', 'ordinal', 'childUnitIds', 'semanticMetadata'],
    {
      unitId: text,
      parentUnitId: text,
      unitType: { const: 'PARAGRAPH' },
      ordinal: nonNegativeInteger,
      childUnitIds: array(text, { unique: true }),
      semanticMetadata: localRef('markdownThematicBreakMetadata'),
      evidenceRefs: array(contentAddressedReference, { unique: true }),
    },
  ),
  markdownParagraphUnit: {
    oneOf: [
      localRef('markdownParagraphTextUnit'),
      localRef('markdownListItemUnit'),
      localRef('markdownThematicBreakUnit'),
    ],
  },
  markdownTableUnit: object(['unitId', 'unitType', 'ordinal', 'childUnitIds', 'semanticMetadata'], {
    unitId: text,
    parentUnitId: text,
    unitType: { const: 'TABLE' },
    ordinal: nonNegativeInteger,
    childUnitIds: array(text, { unique: true }),
    semanticMetadata: localRef('markdownTableMetadata'),
    evidenceRefs: array(contentAddressedReference, { unique: true }),
  }),
  markdownTableRowUnit: object(
    ['unitId', 'unitType', 'ordinal', 'childUnitIds', 'semanticMetadata'],
    {
      unitId: text,
      parentUnitId: text,
      unitType: { const: 'TABLE_ROW' },
      ordinal: nonNegativeInteger,
      childUnitIds: array(text, { unique: true }),
      semanticMetadata: localRef('markdownTableRowMetadata'),
      evidenceRefs: array(contentAddressedReference, { unique: true }),
    },
  ),
  markdownBlankTableCellUnit: object(
    ['unitId', 'unitType', 'ordinal', 'childUnitIds', 'semanticMetadata'],
    {
      unitId: text,
      parentUnitId: text,
      unitType: { const: 'TABLE_CELL' },
      ordinal: nonNegativeInteger,
      childUnitIds: array(text, { unique: true }),
      semanticMetadata: localRef('markdownBlankTableCellMetadata'),
      evidenceRefs: array(contentAddressedReference, { unique: true }),
    },
  ),
  markdownTextTableCellUnit: object(
    ['unitId', 'unitType', 'ordinal', 'childUnitIds', 'text', 'semanticMetadata'],
    {
      unitId: text,
      parentUnitId: text,
      unitType: { const: 'TABLE_CELL' },
      ordinal: nonNegativeInteger,
      text,
      childUnitIds: array(text, { unique: true }),
      semanticMetadata: localRef('markdownTextTableCellMetadata'),
      evidenceRefs: array(contentAddressedReference, { unique: true }),
    },
  ),
  markdownTableCellUnit: {
    oneOf: [localRef('markdownBlankTableCellUnit'), localRef('markdownTextTableCellUnit')],
  },
  markdownDocumentUnit: {
    oneOf: [
      localRef('markdownSectionUnit'),
      localRef('markdownParagraphUnit'),
      localRef('markdownTableUnit'),
      localRef('markdownTableRowUnit'),
      localRef('markdownTableCellUnit'),
    ],
  },
  markdownDocument: object(['documentId', 'title', 'units', 'metadata'], {
    documentId: uuid,
    title: text,
    units: array(localRef('markdownDocumentUnit'), { nonEmpty: true }),
    metadata: localRef('markdownDocumentMetadata'),
  }),
  markdownDocumentContent: object(['schemaRef', 'contentType', 'canonicalizationVersion', 'body'], {
    schemaRef: versionedReference,
    contentType: { const: 'STRUCTURED_DOCUMENT' },
    canonicalizationVersion: { const: '1' },
    body: localRef('markdownDocument'),
  }),
  // Closed identity sidecar: existing identities are inherited from the exact
  // trusted base/source mapping, new identities are derived by Artifact.
  markdownIdentityMapNode: object(['sourceNodePath', 'unitId', 'type', 'ordinal'], {
    sourceNodePath: text,
    unitId: text,
    type: { enum: ['SECTION', 'PARAGRAPH', 'TABLE', 'TABLE_ROW', 'TABLE_CELL'] },
    parentUnitId: text,
    ordinal: nonNegativeInteger,
  }),
  markdownIdentityMapColumn: object(['tableUnitId', 'columnId', 'ordinal'], {
    tableUnitId: text,
    columnId: text,
    ordinal: nonNegativeInteger,
  }),
  markdownIdentityMap: object(
    [
      'profileRef',
      'artifactRef',
      'documentId',
      'candidateOutputId',
      'markdownBytesSha256',
      'nodes',
      'columns',
    ],
    {
      profileRef: versionedReference,
      artifactRef: objectReference,
      documentId: uuid,
      baseRevisionRef: contentAddressedReference,
      baselineMappingRef: snapshotReference,
      candidateOutputId: text,
      markdownBytesSha256: contentHash,
      nodes: array(localRef('markdownIdentityMapNode')),
      columns: array(localRef('markdownIdentityMapColumn')),
    },
  ),
  effectivePeriod: object([], { validFrom: instant, validTo: instant }),
  evidenceRef: object(['evidence', 'relation'], {
    evidence: contentAddressedReference,
    evidenceLinkRef: objectReference,
    relation: { enum: ['SUPPORTS', 'CONTRADICTS', 'CONTEXT_ONLY'] },
    targetClaimRef: typedReference,
    applicabilityScopeRef: scope,
  }),
  justification: object(['reasonCode', 'summary', 'evidenceRefs'], {
    reasonCode,
    summary: text,
    evidenceRefs: array(localRef('evidenceRef')),
    policyRef: versionedReference,
  }),
  representationRef: object(
    [
      'representationId',
      'revision',
      'format',
      'mediaType',
      'objectStorageRef',
      'checksum',
      'renderer',
      'createdAt',
    ],
    {
      representationId: uuid,
      revision: contentAddressedReference,
      format: namespace,
      mediaType: localRef('mediaType'),
      objectStorageRef: localRef('objectLocator'),
      checksum: contentHash,
      renderer: object(['rendererId', 'rendererVersion'], {
        rendererId: namespace,
        rendererVersion: text,
      }),
      createdAt: instant,
    },
  ),
  artifactDefinition: object(
    ['businessScope', 'artifactType', 'title', 'classification', 'deliveryItemRefs', 'metadata'],
    {
      businessScope: localRef('artifactScope'),
      originProjectRef: objectReference,
      artifactType: namespace,
      title: text,
      classification: namespace,
      deliveryItemRefs: array(versionedReference, { unique: true }),
      metadata: canonicalJson,
    },
  ),
  revisionProvenance: object(['principal', 'sourceMaterialRefs', 'toolchainVersions'], {
    principal: objectReference,
    actingForRef: objectReference,
    taskRef: objectReference,
    workOrderRef: objectReference,
    runRef: objectReference,
    agentResultRef: contentAddressedReference,
    contextSnapshotRef: snapshotReference,
    templateBaselineRef: versionedReference,
    regulatoryProfileRef: versionedReference,
    sourceMaterialRefs: array(contentAddressedReference, { unique: true }),
    toolchainVersions: array(canonicalJson),
  }),
  revisionContent: object(
    [
      'artifactRef',
      'branchId',
      'parentRevisionRefs',
      'contentType',
      'contentRef',
      'contentHash',
      'structureSchemaRef',
      'semanticMetadata',
      'changedUnits',
      'changeSummary',
      'provenance',
    ],
    {
      artifactRef: objectReference,
      branchId: uuid,
      parentRevisionRefs: array(contentAddressedReference, { unique: true }),
      contentType: localRef('contentType'),
      contentRef: localRef('objectLocator'),
      contentHash,
      structureSchemaRef: versionedReference,
      semanticMetadata: canonicalJson,
      changedUnits: array(text, { nonEmpty: true, unique: true }),
      changeSummary: text,
      provenance: localRef('revisionProvenance'),
    },
  ),
  initialOrOrdinaryRevisionContent: {
    allOf: [
      localRef('revisionContent'),
      { type: 'object', properties: { parentRevisionRefs: { type: 'array', maxItems: 1 } } },
    ],
  },
  mergeRevisionContent: {
    allOf: [
      localRef('revisionContent'),
      { type: 'object', properties: { parentRevisionRefs: { type: 'array', minItems: 2 } } },
    ],
  },
  mergeDefinition: {
    ...object(
      ['revision', 'mergeStrategy', 'conflictSet', 'conflictResolutionRefs', 'resolvedBy'],
      {
        revision: localRef('mergeRevisionContent'),
        mergeStrategy: namespace,
        conflictSet: array(canonicalJson),
        conflictResolutionRefs: array(typedReference),
        resolvedBy: objectReference,
      },
    ),
    allOf: [
      {
        if: {
          type: 'object',
          properties: { conflictSet: { type: 'array', minItems: 1 } },
        },
        then: {
          type: 'object',
          properties: { conflictResolutionRefs: { type: 'array', minItems: 1 } },
        },
      },
    ],
  },
  representationRegistration: object(
    [
      'revisionRef',
      'format',
      'mediaType',
      'objectRef',
      'checksum',
      'rendererId',
      'rendererVersion',
      'renderAttemptRef',
      'createdAt',
    ],
    {
      revisionRef: contentAddressedReference,
      format: namespace,
      mediaType: localRef('mediaType'),
      objectRef: localRef('objectLocator'),
      checksum: contentHash,
      rendererId: namespace,
      rendererVersion: text,
      renderAttemptRef: objectReference,
      createdAt: instant,
    },
  ),
  effectiveBindingDefinition: object(
    ['purpose', 'revisionRef', 'releaseRef', 'releaseReceiptRefs', 'effectiveFrom'],
    {
      purpose: namespace,
      revisionRef: contentAddressedReference,
      releaseRef: objectReference,
      releaseReceiptRefs: array(contentAddressedReference, { nonEmpty: true, unique: true }),
      effectiveFrom: instant,
      effectiveTo: instant,
    },
  ),
  artifactView: object(
    [
      'artifactRef',
      'aggregateVersion',
      'definition',
      'lifecycleStatus',
      'workingHeads',
      'approvedRevisionRefs',
      'effectiveBindingRefs',
    ],
    {
      artifactRef: objectReference,
      aggregateVersion: nonNegativeInteger,
      definition: localRef('artifactDefinition'),
      lifecycleStatus: localRef('artifactLifecycle'),
      workingHeads: array(canonicalJson),
      approvedRevisionRefs: array(contentAddressedReference, { unique: true }),
      effectiveBindingRefs: array(objectReference, { unique: true }),
    },
  ),
  revisionSnapshot: object(
    [
      'revisionRef',
      'revisionNumber',
      'disposition',
      'contentType',
      'contentRef',
      'parentRevisionRefs',
      'changedUnits',
      'semanticMetadata',
      'provenance',
    ],
    {
      revisionRef: contentAddressedReference,
      revisionNumber: positiveInteger,
      disposition: localRef('revisionDisposition'),
      contentType: localRef('contentType'),
      contentRef: localRef('objectLocator'),
      parentRevisionRefs: array(contentAddressedReference, { unique: true }),
      changedUnits: array(text, { nonEmpty: true, unique: true }),
      semanticMetadata: canonicalJson,
      provenance: localRef('revisionProvenance'),
    },
  ),
  revisionLineage: object(['artifactRef', 'rootRefs', 'nodes', 'edges', 'lineageHash'], {
    artifactRef: objectReference,
    rootRefs: array(contentAddressedReference, { unique: true }),
    nodes: array(localRef('revisionSnapshot')),
    edges: array(canonicalJson),
    lineageHash: contentHash,
  }),
  revisionDiffInputs: object(['left', 'right', 'comparisonSchemaRef'], {
    left: localRef('revisionSnapshot'),
    right: localRef('revisionSnapshot'),
    commonAncestorRef: contentAddressedReference,
    comparisonSchemaRef: versionedReference,
  }),
  revisionValidation: object(['valid', 'exactRef', 'contentAvailable', 'reasons'], {
    valid: { type: 'boolean' },
    exactRef: contentAddressedReference,
    authoritativeScopeRef: scope,
    disposition: localRef('revisionDisposition'),
    contentAvailable: { type: 'boolean' },
    reasons: array(reasonCode),
  }),
  representationView: object(['representationRef', 'status', 'registrationRef'], {
    representationRef: localRef('representationRef'),
    status: namespace,
    registrationRef: contentAddressedReference,
    supersededByRef: localRef('representationRef'),
  }),
  effectiveBindingView: object(['artifactRef', 'purpose', 'asOf'], {
    artifactRef: objectReference,
    purpose: namespace,
    bindingRef: objectReference,
    revisionRef: contentAddressedReference,
    releaseRef: objectReference,
    effectivePeriod: localRef('effectivePeriod'),
    asOf: instant,
  }),
} as const satisfies Readonly<Record<string, JsonSchema>>;

const operationSchemas = {
  'artifact.create_execution_revision': {
    payload: {
      type: 'object',
      additionalProperties: false,
      required: ['runRef', 'revision'],
      properties: {
        runRef: {
          allOf: [
            {
              $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/objectRef',
            },
            {
              type: 'object',
              properties: {
                objectType: {
                  const: 'execution.run',
                },
                scope: {
                  type: 'object',
                  required: ['enterpriseId', 'projectId'],
                  properties: {
                    enterpriseId: {
                      $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                    },
                    projectId: {
                      $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                    },
                  },
                },
              },
            },
          ],
        },
        revision: {
          $ref: 'https://schemas.zhiju.local/modules/artifact/1.0#/$defs/executionRevisionContent',
        },
      },
    },
    result: {
      type: 'object',
      additionalProperties: false,
      required: ['revisionRef', 'creationCommandRef'],
      properties: {
        revisionRef: {
          allOf: [
            {
              $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/contentAddressedRef',
            },
            {
              type: 'object',
              properties: {
                objectType: {
                  const: 'artifact.artifact_revision',
                },
                scope: {
                  type: 'object',
                  required: ['enterpriseId', 'projectId'],
                  properties: {
                    enterpriseId: {
                      $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                    },
                    projectId: {
                      $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                    },
                  },
                },
              },
            },
          ],
        },
        creationCommandRef: {
          allOf: [
            {
              $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/contentAddressedRef',
            },
            {
              type: 'object',
              properties: {
                objectType: {
                  const: 'zhiju.artifact.command_receipt',
                },
                scope: {
                  type: 'object',
                  required: ['enterpriseId', 'projectId'],
                  properties: {
                    enterpriseId: {
                      $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                    },
                    projectId: {
                      $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                    },
                  },
                },
              },
            },
          ],
        },
      },
    },
  },
  'artifact.get_execution_output_fact': {
    payload: {
      type: 'object',
      additionalProperties: false,
      required: ['revisionRef'],
      properties: {
        revisionRef: {
          allOf: [
            {
              $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/contentAddressedRef',
            },
            {
              type: 'object',
              properties: {
                objectType: {
                  const: 'artifact.artifact_revision',
                },
                scope: {
                  type: 'object',
                  required: ['enterpriseId', 'projectId'],
                  properties: {
                    enterpriseId: {
                      $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                    },
                    projectId: {
                      $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                    },
                  },
                },
              },
            },
          ],
        },
      },
    },
    result: {
      type: 'object',
      additionalProperties: false,
      required: [
        'revision',
        'artifactRef',
        'artifactAggregateVersion',
        'artifactLifecycle',
        'businessScope',
        'originProjectRef',
        'contentState',
        'canonicalContent',
        'creationBinding',
        'creationBindingHash',
        'creationReceipt',
        'observedAt',
        'useStatus',
        'reasonCodes',
      ],
      properties: {
        revision: {
          $ref: 'https://schemas.zhiju.local/modules/artifact/1.0#/$defs/revisionSnapshot',
        },
        artifactRef: {
          allOf: [
            {
              $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/objectRef',
            },
            {
              type: 'object',
              properties: {
                objectType: {
                  const: 'artifact.artifact',
                },
                scope: {
                  type: 'object',
                  required: ['enterpriseId', 'projectId'],
                  properties: {
                    enterpriseId: {
                      $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                    },
                    projectId: {
                      $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                    },
                  },
                },
              },
            },
          ],
        },
        artifactAggregateVersion: {
          $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/nonNegativeInteger',
        },
        artifactLifecycle: {
          $ref: 'https://schemas.zhiju.local/modules/artifact/1.0#/$defs/artifactLifecycle',
        },
        businessScope: {
          $ref: 'https://schemas.zhiju.local/modules/artifact/1.0#/$defs/artifactScope',
        },
        originProjectRef: {
          allOf: [
            {
              $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/objectRef',
            },
            {
              type: 'object',
              properties: {
                objectType: {
                  const: 'zhiju.project.project',
                },
                scope: {
                  type: 'object',
                  required: ['enterpriseId', 'projectId'],
                  properties: {
                    enterpriseId: {
                      $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                    },
                    projectId: {
                      $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/uuidV7',
                    },
                  },
                },
              },
            },
          ],
        },
        contentState: {
          const: 'FROZEN',
        },
        canonicalContent: {
          $ref: 'https://schemas.zhiju.local/modules/artifact/1.0#/$defs/canonicalContentPayload',
        },
        creationBinding: {
          $ref: 'https://schemas.zhiju.local/modules/artifact/1.0#/$defs/executionRevisionCreationBinding',
        },
        creationBindingHash: {
          $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/contentHash',
        },
        creationReceipt: {
          $ref: 'https://schemas.zhiju.local/modules/artifact/1.0#/$defs/executionRevisionCreationReceipt',
        },
        observedAt: {
          $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/utcInstant',
        },
        useStatus: {
          enum: ['USABLE', 'STALE', 'REVOKED'],
        },
        reasonCodes: {
          type: 'array',
          items: {
            enum: ['ARTIFACT_EXECUTION_OUTPUT_STALE', 'ARTIFACT_EXECUTION_OUTPUT_REVOKED'],
          },
          uniqueItems: true,
        },
      },
    },
  },
  'artifact.create_artifact': {
    payload: object(['enterpriseRef', 'definition'], {
      enterpriseRef: objectReference,
      definition: localRef('artifactDefinition'),
    }),
  },
  'artifact.update_artifact_metadata': {
    payload: object(['changeReason'], {
      title: text,
      classification: namespace,
      metadataPatch: canonicalJson,
      changeReason: localRef('justification'),
    }),
  },
  'artifact.create_and_seal_revision': {
    payload: object(['revision'], {
      revision: localRef('initialOrOrdinaryRevisionContent'),
      creationCommandRef: contentAddressedReference,
    }),
  },
  'artifact.create_merge_revision': {
    payload: object(['merge'], { merge: localRef('mergeDefinition') }),
  },
  'artifact.move_working_head': {
    payload: object(['branchId', 'newHeadRef', 'moveReason'], {
      branchId: uuid,
      expectedHeadRef: contentAddressedReference,
      newHeadRef: contentAddressedReference,
      moveReason: localRef('justification'),
    }),
  },
  'artifact.register_representation': {
    payload: object(['registration'], { registration: localRef('representationRegistration') }),
  },
  'artifact.withdraw_revision': {
    payload: object(['withdrawalReason'], {
      withdrawalReason: localRef('justification'),
      impactAssessmentRef: contentAddressedReference,
    }),
  },
  'artifact.invalidate_revision': {
    payload: object(['invalidationReason', 'impactAssessmentRef', 'invalidatedAt'], {
      invalidationReason: localRef('justification'),
      impactAssessmentRef: contentAddressedReference,
      invalidatedAt: instant,
    }),
  },
  'artifact.record_approved_revision_binding': {
    payload: object(['revisionRef', 'approvalBundleSnapshotRef', 'boundAt'], {
      revisionRef: contentAddressedReference,
      approvalBundleSnapshotRef: snapshotReference,
      boundAt: instant,
    }),
  },
  'artifact.record_effective_binding': {
    payload: object(['binding', 'releaseCompletionEventRef'], {
      binding: localRef('effectiveBindingDefinition'),
      releaseCompletionEventRef: contentAddressedReference,
    }),
  },
  'artifact.supersede_effective_binding': {
    payload: object(
      ['purpose', 'currentBindingRef', 'supersedingReleaseRef', 'effectiveAt', 'justification'],
      {
        purpose: namespace,
        currentBindingRef: objectReference,
        supersedingReleaseRef: objectReference,
        effectiveAt: instant,
        justification: localRef('justification'),
      },
    ),
  },
  'artifact.archive_artifact': {
    payload: object(['archivedAt', 'archiveReason', 'retentionPolicyRef'], {
      archivedAt: instant,
      archiveReason: localRef('justification'),
      retentionPolicyRef: versionedReference,
    }),
  },
  'artifact.get_artifact': {
    payload: object(['artifactRef'], { artifactRef: objectReference }),
    result: localRef('artifactView'),
  },
  'artifact.get_revision_snapshot': {
    payload: object(['revisionRef'], { revisionRef: contentAddressedReference }),
    result: localRef('revisionSnapshot'),
  },
  'artifact.get_revision_lineage': {
    payload: object(['artifactRef'], {
      artifactRef: objectReference,
      headRef: contentAddressedReference,
      maxDepth: positiveInteger,
    }),
    result: localRef('revisionLineage'),
  },
  'artifact.get_revision_diff_inputs': {
    payload: object(['leftRef', 'rightRef'], {
      leftRef: contentAddressedReference,
      rightRef: contentAddressedReference,
    }),
    result: localRef('revisionDiffInputs'),
  },
  'artifact.validate_revision_ref': {
    payload: object(['revisionRef', 'expectedScopeRef', 'purpose', 'allowedDispositions'], {
      revisionRef: contentAddressedReference,
      expectedScopeRef: scope,
      purpose: namespace,
      allowedDispositions: array(localRef('revisionDisposition'), {
        nonEmpty: true,
        unique: true,
      }),
    }),
    result: localRef('revisionValidation'),
  },
  'artifact.get_representation': {
    payload: object(['representationRef'], { representationRef: localRef('representationRef') }),
    result: localRef('representationView'),
  },
  'artifact.get_effective_binding': {
    payload: object(['artifactRef', 'purpose', 'asOf'], {
      artifactRef: objectReference,
      purpose: namespace,
      asOf: instant,
    }),
    result: localRef('effectiveBindingView'),
  },
  'artifact.ArtifactCreated': {
    payload: object(['artifactRef', 'businessScope', 'artifactType'], {
      artifactRef: objectReference,
      businessScope: localRef('artifactScope'),
      artifactType: namespace,
      originProjectRef: objectReference,
    }),
  },
  'artifact.ArtifactRevisionSealed': {
    payload: object(
      ['artifactRef', 'revisionRef', 'branchId', 'parentRevisionRefs', 'changedUnits'],
      {
        artifactRef: objectReference,
        revisionRef: contentAddressedReference,
        branchId: uuid,
        parentRevisionRefs: array(contentAddressedReference, { unique: true }),
        changedUnits: array(text, { nonEmpty: true, unique: true }),
      },
    ),
  },
  'artifact.MergeRevisionCreated': {
    payload: object(['artifactRef', 'revisionRef', 'parentRevisionRefs', 'mergeStrategy'], {
      artifactRef: objectReference,
      revisionRef: contentAddressedReference,
      parentRevisionRefs: array(contentAddressedReference, { nonEmpty: true, unique: true }),
      mergeStrategy: namespace,
    }),
  },
  'artifact.RevisionInvalidated': {
    payload: object(
      ['artifactRef', 'revisionRef', 'impactAssessmentRef', 'reasonCode', 'invalidatedAt'],
      {
        artifactRef: objectReference,
        revisionRef: contentAddressedReference,
        impactAssessmentRef: contentAddressedReference,
        reasonCode,
        invalidatedAt: instant,
      },
    ),
  },
  'artifact.RepresentationRegistered': {
    payload: object(['artifactRef', 'revisionRef', 'representationRef', 'renderAttemptRef'], {
      artifactRef: objectReference,
      revisionRef: contentAddressedReference,
      representationRef: localRef('representationRef'),
      renderAttemptRef: objectReference,
    }),
  },
  'artifact.ApprovedRevisionBindingRecorded': {
    payload: object(['artifactRef', 'revisionRef', 'approvalBundleSnapshotRef', 'boundAt'], {
      artifactRef: objectReference,
      revisionRef: contentAddressedReference,
      approvalBundleSnapshotRef: snapshotReference,
      boundAt: instant,
    }),
  },
  'artifact.EffectiveBindingChanged': {
    payload: object(['artifactRef', 'purpose', 'revisionRef', 'releaseRef', 'effectiveAt'], {
      artifactRef: objectReference,
      purpose: namespace,
      priorBindingRef: objectReference,
      newBindingRef: objectReference,
      revisionRef: contentAddressedReference,
      releaseRef: objectReference,
      effectiveAt: instant,
    }),
  },
} as const satisfies Readonly<Record<string, OperationContractSchema>>;

function operationDefinitionName(type: string, suffix: 'payload' | 'result'): string {
  return `${type.replaceAll('.', '_')}_${suffix}`;
}

const operationDefinitions = Object.fromEntries(
  Object.entries(operationSchemas).flatMap(([type, contract]) => [
    [operationDefinitionName(type, 'payload'), contract.payload],
    ...('result' in contract
      ? [[operationDefinitionName(type, 'result'), contract.result] as const]
      : []),
  ]),
) as Readonly<Record<string, JsonSchema>>;

export const artifactOperationContracts = Object.freeze(
  Object.fromEntries(
    Object.entries(operationSchemas).map(([type, contract]) => [
      type,
      {
        payloadSchemaRef: `${schemaId}#/$defs/${operationDefinitionName(type, 'payload')}`,
        ...('result' in contract
          ? { resultSchemaRef: `${schemaId}#/$defs/${operationDefinitionName(type, 'result')}` }
          : {}),
      },
    ]),
  ) as Readonly<Record<string, ExecutableArtifactOperationContract>>,
);

export const artifactSchema = {
  $id: schemaId,
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: { ...namedDefinitions, ...operationDefinitions },
} as const satisfies JsonSchema;
