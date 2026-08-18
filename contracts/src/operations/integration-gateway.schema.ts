import type { JsonSchema } from '../schema-types.js';

const schemaId = 'https://schemas.zhiju.local/modules/integration-gateway/1.0';
const common = 'https://schemas.zhiju.local/common/1.0#/$defs/';

type SchemaProperties = Readonly<Record<string, unknown>>;

interface OperationContractSchema {
  readonly payload: JsonSchema;
  readonly result?: JsonSchema;
}

export interface ExecutableIntegrationGatewayOperationContract {
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
const safeSummary = { $ref: `${common}safeSummary` } as const;
const instant = { $ref: `${common}utcInstant` } as const;
const contentHash = { $ref: `${common}contentHash` } as const;
const opaqueCursor = { $ref: `${common}opaqueCursor` } as const;
const pageRequest = { $ref: `${common}pageRequest` } as const;
const duration = { $ref: `${common}duration` } as const;
const evidenceRef = { $ref: `${common}evidenceRef` } as const;
const objectReference = { $ref: `${common}objectRef` } as const;
const versionedReference = { $ref: `${common}versionedRef` } as const;
const typedReference = { $ref: `${common}typedReference` } as const;
const contentAddressedReference = { $ref: `${common}contentAddressedRef` } as const;
const snapshotReference = { $ref: `${common}snapshotRef` } as const;
const externalReference = { $ref: `${common}externalRef` } as const;
const principalReference = { $ref: `${common}principalRef` } as const;
const representationReference = { $ref: `${common}representationRef` } as const;
const sourceWatermark = { $ref: `${common}sourceWatermark` } as const;
const canonicalJson = {} as const;

// =============================================================================
// Closed enums (Module-Spec-007 §2)
// =============================================================================

const adapterKind = {
  enum: ['FEISHU_CHANNEL', 'RUNTIME', 'RENDERER', 'OBJECT_STORAGE', 'EXTERNAL_AUTHORITY'],
} as const;

const attemptStatus = {
  enum: [
    'CREATED',
    'DISPATCHABLE',
    'CLAIMED',
    'IN_FLIGHT',
    'SUCCEEDED',
    'FAILED',
    'UNKNOWN',
    'CANCELLED',
    'QUARANTINED',
  ],
} as const;

const inboundStatus = {
  enum: ['ACCEPTED', 'REJECTED', 'QUARANTINED'],
} as const;

const adapterObservedStatus = {
  enum: ['HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN'],
} as const;

const deliveryMode = {
  enum: ['NEW_MESSAGE', 'REPLY', 'REPLY_IN_THREAD'],
} as const;

const observedOutcome = {
  enum: ['SUCCEEDED', 'FAILED', 'UNKNOWN'],
} as const;

const failureOutcome = {
  enum: ['FAILED', 'UNKNOWN'],
} as const;

// =============================================================================
// Opaque controlled-object-storage locator (mirror artifact / quality pattern)
// =============================================================================

const objectLocator = {
  type: 'string',
  pattern: '^[a-z0-9][a-z0-9._-]*(?:/[A-Za-z0-9._-]+)+$',
} as const;

// =============================================================================
// Reference sets reused across Inbound / Delivery / Quarantine / Health
// =============================================================================

const uniqueRecipientRefs = array(externalReference, { unique: true });
const attachmentRefsArray = array(representationReference);
const conflictRefsArray = array(typedReference);
const adapterCodesArray = array(namespace, { unique: true });
const uniqueObservedHashes = array(contentHash, { nonEmpty: true, unique: true });

// =============================================================================
// Named local definitions (Module-Spec-007 §2 types)
// =============================================================================

const namedDefinitions = {
  adapterKind,
  attemptStatus,
  inboundStatus,
  adapterObservedStatus,
  deliveryMode,
  observedOutcome,
  failureOutcome,
  objectLocator,

  // Module-Spec-007 §2 (line 113) limits businessContextRefs to Project-scoped
  // Task / WorkOrder / InformationRequest / ApprovalRequest / Release. The
  // four per-kind schemas below restate the common typedReference family with
  // an objectType whitelist so the Registry rejects identities that are not
  // approved business types. Same-Project ownership is verified at runtime.
  businessContextObjectRef: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'objectType', 'objectId', 'scope'],
    properties: {
      kind: { const: 'OBJECT' },
      objectType: {
        enum: [
          'execution.task',
          'execution.work_order',
          'execution.information_request',
          'quality.approval_request',
          'release.release',
        ],
      },
      objectId: uuid,
      scope: { $ref: `${common}scopeRef` },
    },
  },
  businessContextVersionedRef: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'objectType', 'objectId', 'versionId', 'scope'],
    properties: {
      kind: { const: 'VERSIONED' },
      objectType: {
        enum: [
          'execution.task',
          'execution.work_order',
          'quality.approval_request',
          'release.release',
        ],
      },
      objectId: uuid,
      versionId: uuid,
      scope: { $ref: `${common}scopeRef` },
    },
  },
  businessContextContentAddressedRef: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'objectType', 'objectId', 'scope', 'contentHash'],
    properties: {
      kind: { const: 'CONTENT_ADDRESSED' },
      objectType: { enum: ['release.release'] },
      objectId: uuid,
      immutableVersionId: uuid,
      scope: { $ref: `${common}scopeRef` },
      contentHash: contentHash,
    },
  },
  businessContextSnapshotRef: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'objectType', 'objectId', 'snapshotId', 'scope', 'contentHash'],
    properties: {
      kind: { const: 'SNAPSHOT' },
      objectType: { enum: ['execution.work_order', 'quality.approval_request'] },
      objectId: uuid,
      snapshotId: uuid,
      scope: { $ref: `${common}scopeRef` },
      contentHash: contentHash,
    },
  },

  // ValueEnvelope<Duration>: mirrors common `valueEnvelope` but narrows the
  // generic argument to ISO 8601 Duration. Module-Spec-007 §4 declares
  // AdapterHealthView.latency as ValueEnvelope<Duration>; the common value
  // envelope intentionally keeps `value` open, so we restate the structure
  // locally with `duration` enforced only in the PRESENT branch. Other
  // presence states forbid `value` entirely.
  valueEnvelopeDuration: {
    type: 'object',
    additionalProperties: false,
    required: ['presence'],
    properties: {
      presence: {
        enum: ['PRESENT', 'UNKNOWN', 'REDACTED', 'NOT_APPLICABLE', 'UNAVAILABLE'],
      },
      value: duration,
      reasonCode,
      evidenceRefs: array(evidenceRef, { unique: true }),
      lastVerifiedAt: instant,
    },
    allOf: [
      {
        if: {
          properties: { presence: { const: 'PRESENT' } },
          required: ['presence'],
        },
        then: {
          required: ['value'],
          properties: { value: duration },
        },
        else: {
          properties: { value: false },
        },
      },
    ],
  },

  // --- Command submissions -------------------------------------------------
  // Module-Spec-007 §2 (line 113) limits businessContextRefs to Project-scoped
  // Task / WorkOrder / InformationRequest / ApprovalRequest / Release
  // references. ExternalRef, Runtime Session and workspace path are forbidden
  // because they would otherwise be promoted from routing / observation into
  // business context. Same-Project ownership is verified at runtime.
  // The common typedReference schemas accept any `objectType`, so we restate
  // each allowed kind locally with the whitelist of approved objectTypes.
  businessContextReference: {
    oneOf: [
      localRef('businessContextObjectRef'),
      localRef('businessContextVersionedRef'),
      localRef('businessContextContentAddressedRef'),
      localRef('businessContextSnapshotRef'),
    ],
  } as const,
  inboundEnvelopeSubmission: object(
    [
      'adapterCode',
      'adapterVersion',
      'accountExternalRef',
      'externalEventRef',
      'externalEventType',
      'receivedAt',
      'authenticationMetadataRef',
      'payloadRef',
      'payloadHash',
      'dataClassification',
      'transportMetadata',
    ],
    {
      adapterCode: namespace,
      adapterVersion: text,
      accountExternalRef: externalReference,
      externalEventRef: externalReference,
      externalEventType: text,
      occurredAt: instant,
      receivedAt: instant,
      authenticationMetadataRef: contentAddressedReference,
      payloadRef: localRef('objectLocator'),
      payloadHash: contentHash,
      dataClassification: {
        enum: [
          'PUBLIC_AUTHORITY',
          'INTERNAL',
          'CUSTOMER_CONFIDENTIAL',
          'RESTRICTED_PERSONAL',
          'REGULATED',
        ],
      },
      transportMetadata: canonicalJson,
    },
  ),
  channelBindingDefinition: object(
    [
      'adapterCode',
      'accountExternalRef',
      'channelExternalRef',
      'projectRef',
      'enterpriseRef',
      'purpose',
      'bindingPolicyRef',
      'effectivePeriod',
    ],
    {
      adapterCode: namespace,
      accountExternalRef: externalReference,
      channelExternalRef: externalReference,
      threadOrTopicExternalRef: externalReference,
      projectRef: objectReference,
      enterpriseRef: objectReference,
      businessContextRefs: array(localRef('businessContextReference'), { unique: true }),
      runtimeContextExternalRef: externalReference,
      purpose: namespace,
      bindingPolicyRef: versionedReference,
      effectivePeriod: { $ref: `${common}effectivePeriod` },
    },
  ),
  feishuDeliveryRequest: object(
    [
      'sourceBusinessRef',
      'destinationBindingRef',
      'recipientRefs',
      'contentContractRef',
      'attachmentRefs',
      'stableIdempotencyKey',
      'requestedAt',
      'deliveryPolicyRef',
    ],
    {
      sourceBusinessRef: typedReference,
      destinationBindingRef: objectReference,
      deliveryMode: localRef('deliveryMode'),
      replyToExternalRef: externalReference,
      recipientRefs: uniqueRecipientRefs,
      contentContractRef: contentAddressedReference,
      attachmentRefs: attachmentRefsArray,
      interactionContractRef: contentAddressedReference,
      stableIdempotencyKey: text,
      requestedAt: instant,
      deliveryPolicyRef: versionedReference,
    },
    [
      // Module-Spec-007 §2 (line 115) and Feishu Channel Contract §9.2 require
      // that REPLY and REPLY_IN_THREAD always carry a `replyToExternalRef`
      // referencing the originating message of the same ChannelBinding. The
      // same-Binding invariant is enforced at runtime; the Schema layer only
      // guarantees the structural hook is mandatory.
      {
        if: {
          properties: { deliveryMode: { enum: ['REPLY', 'REPLY_IN_THREAD'] } },
          required: ['deliveryMode'],
        },
        then: {
          required: ['replyToExternalRef'],
          properties: {
            replyToExternalRef: externalReference,
          },
        },
      },
    ],
  ),
  runtimeDispatchRequest: object(
    [
      'workOrderRef',
      'runRef',
      'workOrderContractRef',
      'contextSnapshotRef',
      'capabilityGrantRef',
      'runtimeBinding',
      'stableIdempotencyKey',
      'requestedAt',
    ],
    {
      workOrderRef: objectReference,
      runRef: objectReference,
      workOrderContractRef: contentAddressedReference,
      contextSnapshotRef: snapshotReference,
      capabilityGrantRef: contentAddressedReference,
      runtimeBinding: canonicalJson,
      stableIdempotencyKey: text,
      requestedAt: instant,
    },
  ),
  runtimeControlRequest: object(
    ['runRef', 'runtimeAttemptRef', 'reasonCode', 'stableIdempotencyKey', 'requestedAt'],
    {
      runRef: objectReference,
      runtimeAttemptRef: objectReference,
      continuationRef: externalReference,
      reasonCode,
      stableIdempotencyKey: text,
      requestedAt: instant,
    },
  ),
  // Resume is structurally distinct from cancel: Module-Spec-007 §3 requires
  // continuationRef for resume but allows cancel to omit the field. Reusing
  // `runtimeControlRequest` as an optional shape would let a no-continuation
  // resume slip past the Registry, so resume gets an operation-specific overlay.
  runtimeResumeRequest: {
    allOf: [
      localRef('runtimeControlRequest'),
      {
        type: 'object',
        required: ['continuationRef'],
        properties: { continuationRef: externalReference },
      },
    ],
  } as const,
  renderRequest: object(
    [
      'revisionRef',
      'canonicalContentRef',
      'inputHash',
      'outputFormat',
      'rendererId',
      'rendererVersion',
      'renderPolicyRef',
      'stableIdempotencyKey',
      'requestedAt',
    ],
    {
      revisionRef: contentAddressedReference,
      canonicalContentRef: localRef('objectLocator'),
      inputHash: contentHash,
      outputFormat: namespace,
      rendererId: namespace,
      rendererVersion: text,
      renderPolicyRef: versionedReference,
      stableIdempotencyKey: text,
      requestedAt: instant,
    },
  ),
  rawReceiptSubmission: object(
    [
      'attemptKind',
      'attemptRef',
      'providerReceiptRef',
      'receiptPayloadRef',
      'receiptPayloadHash',
      'observedOutcome',
      'recordedAt',
    ],
    {
      attemptKind: localRef('adapterKind'),
      attemptRef: objectReference,
      providerReceiptRef: externalReference,
      receiptPayloadRef: localRef('objectLocator'),
      receiptPayloadHash: contentHash,
      observedOutcome: localRef('observedOutcome'),
      occurredAt: instant,
      recordedAt: instant,
    },
  ),
  quarantineDefinition: object(
    ['conflictRefs', 'reasonCode', 'observedHashes', 'safeDiagnostic', 'quarantinedAt'],
    {
      inboundEnvelopeRef: contentAddressedReference,
      attemptRef: objectReference,
      conflictRefs: conflictRefsArray,
      reasonCode,
      observedHashes: uniqueObservedHashes,
      safeDiagnostic: safeSummary,
      quarantinedAt: instant,
    },
  ),

  // --- Result views --------------------------------------------------------
  channelBindingView: object(
    ['channelBindingRef', 'aggregateVersion', 'definition', 'status', 'resolvedPurpose'],
    {
      channelBindingRef: objectReference,
      aggregateVersion: { type: 'integer', minimum: 0 },
      definition: localRef('channelBindingDefinition'),
      // Module-Spec-007 §4 declares ChannelBindingView.status as NamespaceCode;
      // the actual binding lifecycle (Feishu Channel Contract §5.3 ACTIVE /
      // SUSPENDED / REVOKED) is a runtime narrowing and is enforced by the
      // owning Adapter, not by this Query Result schema.
      status: namespace,
      resolvedPurpose: namespace,
    },
  ),
  adapterAttemptView: object(
    [
      'attemptRef',
      'adapterKind',
      'status',
      'stableIdempotencyKeyHash',
      'requestPayloadHash',
      'updatedAt',
    ],
    {
      attemptRef: objectReference,
      adapterKind: localRef('adapterKind'),
      status: localRef('attemptStatus'),
      stableIdempotencyKeyHash: contentHash,
      requestPayloadHash: contentHash,
      leaseExpiresAt: instant,
      rawReceiptRef: contentAddressedReference,
      externalRef: externalReference,
      errorCode: reasonCode,
      updatedAt: instant,
    },
  ),
  adapterHealthView: object(
    [
      'adapterCode',
      'adapterVersion',
      'observedStatus',
      'capabilityCodes',
      'observedAt',
      'latency',
      'observationRef',
    ],
    {
      adapterCode: namespace,
      adapterVersion: text,
      observedStatus: localRef('adapterObservedStatus'),
      capabilityCodes: array(namespace, { unique: true }),
      observedAt: instant,
      latency: localRef('valueEnvelopeDuration'),
      safeErrorCode: reasonCode,
      observationRef: contentAddressedReference,
    },
  ),

  // --- Query result page items ---------------------------------------------
  adapterHealthPage: object(['items', 'snapshotAt', 'sourceWatermarks'], {
    items: array(localRef('adapterHealthView')),
    nextCursor: opaqueCursor,
    snapshotAt: instant,
    sourceWatermarks: array(sourceWatermark, { unique: true }),
  }),

  // --- Event payloads ------------------------------------------------------
  inboundEnvelopeAcceptedPayload: object(
    [
      'inboundEnvelopeRef',
      'adapterCode',
      'externalEventRef',
      'resolvedPrincipalRef',
      'targetCommandRef',
    ],
    {
      inboundEnvelopeRef: contentAddressedReference,
      adapterCode: namespace,
      externalEventRef: externalReference,
      resolvedPrincipalRef: principalReference,
      targetCommandRef: contentAddressedReference,
    },
  ),
  inboundEnvelopeRejectedPayload: object(['adapterCode', 'externalEventRef', 'reasonCode'], {
    inboundEnvelopeRef: contentAddressedReference,
    adapterCode: namespace,
    externalEventRef: externalReference,
    reasonCode,
    quarantineRef: contentAddressedReference,
  }),
  channelAnswerReceivedPayload: object(
    [
      'inboundEnvelopeRef',
      'channelBindingRef',
      'informationRequestRef',
      'responderRef',
      'normalizedAnswerRef',
      'sourceExternalRef',
    ],
    {
      inboundEnvelopeRef: contentAddressedReference,
      channelBindingRef: objectReference,
      informationRequestRef: objectReference,
      responderRef: principalReference,
      normalizedAnswerRef: contentAddressedReference,
      sourceExternalRef: externalReference,
    },
  ),
  channelDeliverySucceededPayload: object(
    ['attemptRef', 'sourceBusinessRef', 'destinationBindingRef', 'rawReceiptRef', 'occurredAt'],
    {
      attemptRef: objectReference,
      sourceBusinessRef: typedReference,
      destinationBindingRef: objectReference,
      rawReceiptRef: contentAddressedReference,
      occurredAt: instant,
    },
  ),
  channelDeliveryFailedPayload: object(
    ['attemptRef', 'sourceBusinessRef', 'outcome', 'reasonCode'],
    {
      attemptRef: objectReference,
      sourceBusinessRef: typedReference,
      outcome: localRef('failureOutcome'),
      reasonCode,
      rawReceiptRef: contentAddressedReference,
    },
  ),
  runtimeDispatchSucceededPayload: object(
    ['attemptRef', 'workOrderRef', 'runRef', 'runtimeSessionRef', 'rawReceiptRef'],
    {
      attemptRef: objectReference,
      workOrderRef: objectReference,
      runRef: objectReference,
      runtimeSessionRef: externalReference,
      rawReceiptRef: contentAddressedReference,
    },
  ),
  runtimeDispatchFailedPayload: object(
    ['attemptRef', 'workOrderRef', 'runRef', 'outcome', 'reasonCode'],
    {
      attemptRef: objectReference,
      workOrderRef: objectReference,
      runRef: objectReference,
      outcome: localRef('failureOutcome'),
      reasonCode,
    },
  ),
  renderSucceededPayload: object(
    [
      'attemptRef',
      'revisionRef',
      'outputObjectRef',
      'outputChecksum',
      'rendererId',
      'rendererVersion',
      'rawReceiptRef',
    ],
    {
      attemptRef: objectReference,
      revisionRef: contentAddressedReference,
      outputObjectRef: localRef('objectLocator'),
      outputChecksum: contentHash,
      rendererId: namespace,
      rendererVersion: text,
      rawReceiptRef: contentAddressedReference,
    },
  ),
  renderFailedPayload: object(
    ['attemptRef', 'revisionRef', 'outcome', 'reasonCode', 'rendererId', 'rendererVersion'],
    {
      attemptRef: objectReference,
      revisionRef: contentAddressedReference,
      outcome: localRef('failureOutcome'),
      reasonCode,
      rendererId: namespace,
      rendererVersion: text,
    },
  ),
} as const satisfies Readonly<Record<string, JsonSchema>>;

// =============================================================================
// Operation payload / result schemas (Module-Spec-007 §3 / §4 / §5)
// =============================================================================

const operationSchemas = {
  // --- Commands ------------------------------------------------------------
  'integration.accept_inbound_envelope': {
    payload: object(['submission'], {
      submission: localRef('inboundEnvelopeSubmission'),
    }),
  },
  'integration.bind_channel_context': {
    payload: object(['definition', 'bindingDecisionRef'], {
      definition: localRef('channelBindingDefinition'),
      bindingDecisionRef: contentAddressedReference,
    }),
  },
  'integration.request_feishu_delivery': {
    payload: object(['request'], {
      request: localRef('feishuDeliveryRequest'),
    }),
  },
  'integration.request_runtime_dispatch': {
    payload: object(['request'], {
      request: localRef('runtimeDispatchRequest'),
    }),
  },
  'integration.request_runtime_cancel': {
    payload: object(['request'], {
      request: localRef('runtimeControlRequest'),
    }),
  },
  'integration.request_runtime_resume': {
    payload: object(['request'], {
      request: localRef('runtimeResumeRequest'),
    }),
  },
  'integration.request_render': {
    payload: object(['request'], {
      request: localRef('renderRequest'),
    }),
  },
  'integration.record_external_receipt': {
    payload: object(['receipt'], {
      receipt: localRef('rawReceiptSubmission'),
    }),
  },
  'integration.quarantine_external_event': {
    payload: object(['definition'], {
      definition: localRef('quarantineDefinition'),
    }),
  },

  // --- Queries (with 5 result schemas) -------------------------------------
  'integration.get_channel_binding': {
    payload: object(['purpose'], {
      bindingRef: objectReference,
      adapterCode: namespace,
      accountExternalRef: externalReference,
      channelExternalRef: externalReference,
      threadOrTopicExternalRef: externalReference,
      purpose: namespace,
    }),
    result: localRef('channelBindingView'),
  },
  'integration.get_delivery_attempt': {
    payload: object(['attemptRef'], {
      attemptRef: objectReference,
    }),
    result: localRef('adapterAttemptView'),
  },
  'integration.get_runtime_attempt': {
    payload: object(['attemptRef'], {
      attemptRef: objectReference,
    }),
    result: localRef('adapterAttemptView'),
  },
  'integration.get_render_attempt': {
    payload: object(['attemptRef'], {
      attemptRef: objectReference,
    }),
    result: localRef('adapterAttemptView'),
  },
  'integration.get_adapter_health': {
    payload: object(['adapterCodes', 'page'], {
      adapterCodes: adapterCodesArray,
      observedAfter: instant,
      page: pageRequest,
    }),
    result: localRef('adapterHealthPage'),
  },

  // --- Events --------------------------------------------------------------
  'integration.InboundEnvelopeAccepted': {
    payload: object(['inboundEnvelopeRef', 'adapterCode', 'externalEventRef'], {
      inboundEnvelopeRef: contentAddressedReference,
      adapterCode: namespace,
      externalEventRef: externalReference,
      resolvedPrincipalRef: principalReference,
      targetCommandRef: contentAddressedReference,
    }),
  },
  'integration.InboundEnvelopeRejected': {
    payload: object(['adapterCode', 'externalEventRef', 'reasonCode'], {
      inboundEnvelopeRef: contentAddressedReference,
      adapterCode: namespace,
      externalEventRef: externalReference,
      reasonCode,
      quarantineRef: contentAddressedReference,
    }),
  },
  'integration.ChannelAnswerReceived': {
    payload: object(
      [
        'inboundEnvelopeRef',
        'channelBindingRef',
        'informationRequestRef',
        'responderRef',
        'normalizedAnswerRef',
        'sourceExternalRef',
      ],
      {
        inboundEnvelopeRef: contentAddressedReference,
        channelBindingRef: objectReference,
        informationRequestRef: objectReference,
        responderRef: principalReference,
        normalizedAnswerRef: contentAddressedReference,
        sourceExternalRef: externalReference,
      },
    ),
  },
  'integration.ChannelDeliverySucceeded': {
    payload: object(
      ['attemptRef', 'sourceBusinessRef', 'destinationBindingRef', 'rawReceiptRef', 'occurredAt'],
      {
        attemptRef: objectReference,
        sourceBusinessRef: typedReference,
        destinationBindingRef: objectReference,
        rawReceiptRef: contentAddressedReference,
        occurredAt: instant,
      },
    ),
  },
  'integration.ChannelDeliveryFailed': {
    payload: object(['attemptRef', 'sourceBusinessRef', 'outcome', 'reasonCode'], {
      attemptRef: objectReference,
      sourceBusinessRef: typedReference,
      outcome: localRef('failureOutcome'),
      reasonCode,
      rawReceiptRef: contentAddressedReference,
    }),
  },
  'integration.RuntimeDispatchSucceeded': {
    payload: object(
      ['attemptRef', 'workOrderRef', 'runRef', 'runtimeSessionRef', 'rawReceiptRef'],
      {
        attemptRef: objectReference,
        workOrderRef: objectReference,
        runRef: objectReference,
        runtimeSessionRef: externalReference,
        rawReceiptRef: contentAddressedReference,
      },
    ),
  },
  'integration.RuntimeDispatchFailed': {
    payload: object(['attemptRef', 'workOrderRef', 'runRef', 'outcome', 'reasonCode'], {
      attemptRef: objectReference,
      workOrderRef: objectReference,
      runRef: objectReference,
      outcome: localRef('failureOutcome'),
      reasonCode,
    }),
  },
  'integration.RenderSucceeded': {
    payload: object(
      [
        'attemptRef',
        'revisionRef',
        'outputObjectRef',
        'outputChecksum',
        'rendererId',
        'rendererVersion',
        'rawReceiptRef',
      ],
      {
        attemptRef: objectReference,
        revisionRef: contentAddressedReference,
        outputObjectRef: localRef('objectLocator'),
        outputChecksum: contentHash,
        rendererId: namespace,
        rendererVersion: text,
        rawReceiptRef: contentAddressedReference,
      },
    ),
  },
  'integration.RenderFailed': {
    payload: object(
      ['attemptRef', 'revisionRef', 'outcome', 'reasonCode', 'rendererId', 'rendererVersion'],
      {
        attemptRef: objectReference,
        revisionRef: contentAddressedReference,
        outcome: localRef('failureOutcome'),
        reasonCode,
        rendererId: namespace,
        rendererVersion: text,
      },
    ),
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

export const integrationGatewayOperationContracts = Object.freeze(
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
  ) as Readonly<Record<string, ExecutableIntegrationGatewayOperationContract>>,
);

export const integrationGatewaySchema = {
  $id: schemaId,
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: {
    ...namedDefinitions,
    ...operationDefinitions,
  },
} as const satisfies JsonSchema;
