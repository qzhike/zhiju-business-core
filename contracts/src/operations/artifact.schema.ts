import type { JsonSchema } from '../schema-types.js';

const schemaId = 'https://schemas.zhiju.local/modules/artifact/1.0';
const common = 'https://schemas.zhiju.local/common/1.0#/$defs/';

export const artifactCanonicalContentPayloadSchemaRef = `${schemaId}#/$defs/canonicalContentPayload`;
export const artifactCanonicalContentManifestSchemaRef = `${schemaId}#/$defs/canonicalContentManifest`;

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
