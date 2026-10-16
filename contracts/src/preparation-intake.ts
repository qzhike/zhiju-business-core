import type { Common } from './generated/types/common.js';
import type { PreparationProjectScope, WorkspaceCommandInput } from './preparation-transport.js';
export interface CustomerZipIntakePayload {
  readonly projectRef: Common.ObjectRef;
  readonly preparationRequestRef: Common.ObjectRef;
  readonly originalPreparationKey: string;
  readonly preparationPresetRef: Common.VersionedRef;
  readonly preparationPresetHash: Common.ContentHash;
  readonly originalName: string;
  readonly declaredByteLength: number;
  readonly zipBytesSha256: Common.ContentHash;
  readonly intakePolicyRef: Common.VersionedRef;
  readonly intakePolicyHash: Common.ContentHash;
  readonly submittedNote?: string;
  readonly analysisIntent: 'ANALYZE';
}
export interface CustomerZipRestartPayload {
  readonly intakeRef: Common.ObjectRef;
  readonly originalKey: string;
  readonly originalPayloadHash: Common.ContentHash;
  readonly expectedUploadGeneration: 1;
}
export type CustomerZipSelector =
  | { readonly by: 'INTAKE'; readonly intakeRef: Common.ObjectRef }
  | {
      readonly by: 'PREPARATION_REQUEST';
      readonly preparationRequestRef: Common.ObjectRef;
      readonly originalPreparationKey: string;
    };
export interface CustomerZipQuery {
  readonly scopeRef: PreparationProjectScope;
  readonly payload: CustomerZipSelector;
  readonly correlationId: string;
}
export type CustomerZipOriginalCommand = WorkspaceCommandInput<CustomerZipIntakePayload>;
const common = 'https://schemas.zhiju.local/common/1.0#/$defs/';
const ref = (name: string) => ({ $ref: `${common}${name}` });
const object = (required: readonly string[], properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});
const text = { type: 'string', minLength: 1 };
const projectScope = object(['enterpriseId', 'projectId'], {
  enterpriseId: ref('uuidV7'),
  projectId: ref('uuidV7'),
});
const exact = (type: string, kind = 'objectRef', scoped = true) => ({
  allOf: [
    ref(kind),
    {
      type: 'object',
      properties: { objectType: { const: type }, scope: scoped ? projectScope : object([], {}) },
    },
  ],
});
const intakeRef = exact('zhiju.integration.customer_zip_intake');
const requestRef = exact('zhiju.project.preparation_request');
const manifestRef = exact('zhiju.integration.customer_input_manifest', 'snapshotRef');
const intakeReceipt = exact('zhiju.integration.command_receipt');

const payloadProperties = {
  projectRef: exact('zhiju.project.project'),
  preparationRequestRef: requestRef,
  originalPreparationKey: text,
  preparationPresetRef: exact('zhiju.project.preparation_preset', 'versionedRef', false),
  preparationPresetHash: ref('contentHash'),
  originalName: { type: 'string', minLength: 1, maxLength: 1024 },
  declaredByteLength: { type: 'integer', minimum: 1, maximum: 104857600 },
  zipBytesSha256: ref('contentHash'),
  intakePolicyRef: exact('zhiju.integration.customer_zip_policy', 'versionedRef', false),
  intakePolicyHash: ref('contentHash'),
  submittedNote: { type: 'string', minLength: 1, maxLength: 4096 },
  analysisIntent: { const: 'ANALYZE' },
};
export const customerZipIntakeContractDefinitions = {
  integration_request_customer_zip_intake_payload: object(
    Object.keys(payloadProperties).filter((k) => k !== 'submittedNote'),
    payloadProperties,
  ),
  integration_restart_customer_zip_upload_payload: object(
    ['intakeRef', 'originalKey', 'originalPayloadHash', 'expectedUploadGeneration'],
    {
      intakeRef,
      originalKey: text,
      originalPayloadHash: ref('contentHash'),
      expectedUploadGeneration: { const: 1 },
    },
  ),
  integration_get_customer_zip_intake_payload: {
    oneOf: [
      object(['by', 'intakeRef'], { by: { const: 'INTAKE' }, intakeRef }),
      object(['by', 'preparationRequestRef', 'originalPreparationKey'], {
        by: { const: 'PREPARATION_REQUEST' },
        preparationRequestRef: requestRef,
        originalPreparationKey: text,
      }),
    ],
  },
  integration_CustomerZipManifestCommitted_payload: object(
    [
      'intakeRef',
      'preparationRequestRef',
      'projectRef',
      'manifestRef',
      'submissionPayloadHash',
      'analysisIntent',
    ],
    {
      intakeRef,
      preparationRequestRef: requestRef,
      projectRef: exact('zhiju.project.project'),
      manifestRef,
      submissionPayloadHash: ref('contentHash'),
      analysisIntent: { const: 'ANALYZE' },
    },
  ),
};
const hash = ref('contentHash'),
  instant = ref('utcInstant');
const positive = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const nativeObject = object(['kind', 'objectType', 'objectId', 'scope'], {
  kind: { const: 'OBJECT' },
  objectType: { enum: ['CommandReceipt'] },
  objectId: ref('uuidV7'),
  scope: ref('scopeRef'),
});
const nativeContent = object(['kind', 'objectType', 'objectId', 'scope', 'contentHash'], {
  kind: { const: 'CONTENT_ADDRESSED' },
  objectType: { enum: ['SourceMaterial', 'ValidationResult'] },
  objectId: ref('uuidV7'),
  scope: ref('scopeRef'),
  contentHash: ref('contentHash'),
  immutableVersionId: ref('uuidV7'),
});
const receiptReference = { anyOf: [ref('typedReference'), nativeObject, nativeContent] };
const sourceReference = {
  anyOf: [
    exact('zhiju.project.source_material', 'contentAddressedRef'),
    {
      allOf: [
        nativeContent,
        {
          type: 'object',
          properties: { objectType: { const: 'SourceMaterial' }, scope: projectScope },
        },
      ],
    },
  ],
};
const validationReference = {
  anyOf: [
    exact('zhiju.project.validation_result', 'contentAddressedRef'),
    {
      allOf: [
        nativeContent,
        {
          type: 'object',
          properties: { objectType: { const: 'ValidationResult' }, scope: projectScope },
        },
      ],
    },
  ],
};
const refs = { type: 'array', items: receiptReference };
const reasons = { type: 'array', items: ref('reasonCode') };
const upload = object(
  [
    'generation',
    'token',
    'expiresAt',
    'method',
    'path',
    'expectedByteLength',
    'expectedZipBytesSha256',
  ],
  {
    generation: { enum: [1, 2] },
    token: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
    expiresAt: instant,
    method: { const: 'PUT' },
    path: {
      type: 'string',
      pattern:
        '^/api/customer-intakes/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/zip$',
    },
    expectedByteLength: { type: 'integer', minimum: 1, maximum: 104857600 },
    expectedZipBytesSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  },
);
const scope = object(['enterpriseId', 'projectId'], {
  enterpriseId: ref('uuidV7'),
  projectId: ref('uuidV7'),
});
const command = (payload: unknown, type: string) =>
  object(
    [
      'commandId',
      'type',
      'version',
      'scopeRef',
      'targetRef',
      'idempotencyKey',
      'correlationId',
      'requestedAt',
      'payload',
      'integrity',
      ...(type === 'integration.restart_customer_zip_upload' ? ['expectedAggregateVersion'] : []),
    ],
    {
      commandId: ref('uuidV7'),
      type: { const: type },
      version: { const: '1.0' },
      scopeRef: scope,
      targetRef: intakeRef,
      idempotencyKey: text,
      correlationId: ref('uuidV7'),
      requestedAt: instant,
      payload,
      integrity: object(['canonicalizationVersion', 'payloadHash'], {
        canonicalizationVersion: { const: '1' },
        payloadHash: hash,
      }),
      ...(type === 'integration.restart_customer_zip_upload'
        ? { expectedAggregateVersion: positive }
        : {}),
      causationId: ref('uuidV7'),
      deadline: instant,
    },
  );
const analysis = object(['status'], {
  status: {
    enum: [
      'WAITING_INPUT',
      'PENDING',
      'WAITING_CAPABILITY',
      'BLOCKED_AUTHORIZATION',
      'PARTIAL',
      'UNKNOWN',
      'STALE',
      'ACCEPTED',
    ],
  },
  reasonCodes: reasons,
  sourceReceiptRefs: refs,
  receiptRefs: refs,
  taskRef: exact('zhiju.execution.task'),
  analysisRequestRef: exact('zhiju.execution.preparation_analysis_request'),
  preparationSourceRef: exact('zhiju.project.preparation_source', 'snapshotRef'),
  intakeRef,
  manifestRef,
  steps: object(
    ['SOURCE', 'TASK', 'ANALYSIS_REQUEST'],
    Object.fromEntries(
      ['SOURCE', 'TASK', 'ANALYSIS_REQUEST'].map((name) => [
        name,
        object(['status', 'refs', 'receiptRefs', 'reasonCodes'], {
          status: {
            enum: ['NOT_STARTED', 'PENDING', 'OBSERVED', 'COMMITTED', 'FAILED', 'UNKNOWN'],
          },
          refs: { type: 'array', items: receiptReference },
          receiptRefs: refs,
          reasonCodes: reasons,
          aggregateVersion: positive,
        }),
      ]),
    ),
  ),
  sourceWatermarks: { type: 'array', items: ref('sourceWatermark') },
});
export const customerZipIntakeResultDefinitions = {
  integration_request_customer_zip_intake_result: {
    ...object(
      [
        'intakeRef',
        'originalCommandId',
        'originalKey',
        'payloadHash',
        'receiptRef',
        'disposition',
        'analysis',
      ],
      {
        intakeRef,
        originalCommandId: ref('uuidV7'),
        originalKey: text,
        payloadHash: hash,
        receiptRef: intakeReceipt,
        upload,
        disposition: { enum: ['ACCEPTED', 'IDEMPOTENT_REPLAY'] },
        analysis,
      },
    ),
    allOf: [
      {
        if: {
          type: 'object',
          required: ['disposition'],
          properties: { disposition: { const: 'ACCEPTED' } },
        },
        then: { type: 'object', properties: { upload }, required: ['upload'] },
      },
    ],
  },
  integration_restart_customer_zip_upload_result: object(
    ['intakeRef', 'originalKey', 'originalPayloadHash', 'receiptRef'],
    { intakeRef, originalKey: text, originalPayloadHash: hash, upload, receiptRef: intakeReceipt },
  ),
  integration_get_customer_zip_intake_result: object(
    [
      'intakeRef',
      'aggregateVersion',
      'preparationRequestRef',
      'originalCommand',
      'originalKey',
      'payloadHash',
      'analysisIntent',
      'uploadState',
      'custody',
      'analysis',
      'allowedActions',
      'sourceWatermarks',
    ],
    {
      intakeRef,
      aggregateVersion: positive,
      preparationRequestRef: requestRef,
      originalCommand: command(
        customerZipIntakeContractDefinitions.integration_request_customer_zip_intake_payload,
        'integration.request_customer_zip_intake',
      ),
      originalKey: text,
      payloadHash: hash,
      restartCommand: command(
        customerZipIntakeContractDefinitions.integration_restart_customer_zip_upload_payload,
        'integration.restart_customer_zip_upload',
      ),
      submittedNote: { type: 'string', minLength: 1, maxLength: 4096 },
      analysisIntent: { const: 'ANALYZE' },
      uploadState: object(['generation', 'state', 'restartsUsed', 'expiresAt', 'reasonCodes'], {
        generation: { enum: [1, 2] },
        state: { enum: ['ISSUED', 'RECEIVING', 'CLOSED_NO_OBJECT', 'STAGED', 'UNKNOWN'] },
        restartsUsed: { enum: [0, 1] },
        expiresAt: instant,
        reasonCodes: reasons,
      }),
      custody: object(['status', 'receiptRefs', 'reasonCodes'], {
        status: {
          enum: ['RECEIVING', 'STAGED', 'EXTRACTING', 'READY', 'PARTIAL', 'FAILED', 'UNKNOWN'],
        },
        receiptRefs: refs,
        manifestRef,
        entries: {
          type: 'array',
          items: object(
            [
              'entryId',
              'ordinal',
              'originalName',
              'normalizedPath',
              'mediaType',
              'byteLength',
              'bytesSha256',
              'sourceRef',
              'validationRef',
              'status',
              'reasonCodes',
            ],
            {
              entryId: ref('uuidV7'),
              ordinal: { type: 'integer', minimum: 0 },
              originalName: text,
              normalizedPath: text,
              mediaType: text,
              byteLength: { type: 'integer', minimum: 0 },
              bytesSha256: hash,
              sourceRef: sourceReference,
              validationRef: validationReference,
              status: { enum: ['ANALYZABLE', 'UNSUPPORTED', 'CORRUPT', 'READ_LIMITED'] },
              reasonCodes: reasons,
            },
          ),
        },
        reasonCodes: reasons,
      }),
      analysis,
      allowedActions: { type: 'array', items: { enum: ['RESTART'] } },
      sourceWatermarks: { type: 'array', items: ref('sourceWatermark') },
    },
  ),
};
