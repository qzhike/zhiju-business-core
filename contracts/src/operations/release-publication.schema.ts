import type { JsonSchema } from '../schema-types.js';

const schemaId = 'https://schemas.zhiju.local/modules/release-publication/1.0';
const common = 'https://schemas.zhiju.local/common/1.0#/$defs/';

type SchemaProperties = Readonly<Record<string, unknown>>;

interface OperationContractSchema {
  readonly payload: JsonSchema;
  readonly result?: JsonSchema;
}

export interface ExecutableReleasePublicationOperationContract {
  readonly payloadSchemaRef: string;
  readonly resultSchemaRef?: string;
}

function object(required: readonly string[], properties: SchemaProperties): JsonSchema {
  return { type: 'object', additionalProperties: false, required, properties };
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
const positiveInt = { $ref: `${common}positiveInteger` } as const;
const objectReference = { $ref: `${common}objectRef` } as const;
const versionedReference = { $ref: `${common}versionedRef` } as const;
const typedReference = { $ref: `${common}typedReference` } as const;
const contentAddressedReference = { $ref: `${common}contentAddressedRef` } as const;
const snapshotReference = { $ref: `${common}snapshotRef` } as const;
const externalReference = { $ref: `${common}externalRef` } as const;
const evidenceRef = { $ref: `${common}evidenceRef` } as const;
const releasePackageRef = { $ref: `${common}releasePackageRef` } as const;
const opaqueCursor = { $ref: `${common}opaqueCursor` } as const;
const pageRequest = { $ref: `${common}pageRequest` } as const;
const canonicalJson = {} as const;

// =============================================================================
// Enums (Module-Spec-006 §2)
// =============================================================================

const releasePurpose = {
  enum: [
    'CUSTOMER_DELIVERY',
    'REGULATORY_SUBMISSION',
    'INTERNAL_EFFECTIVE_USE',
    'FEISHU_PUBLICATION',
    'CONTROLLED_EXPORT',
  ],
} as const;

const releaseStatus = {
  enum: [
    'DRAFT',
    'PREPARED',
    'VALIDATING',
    'AUTHORIZED',
    'PUBLISHING',
    'RELEASED',
    'PARTIALLY_RELEASED',
    'FAILED',
    'CANCELLED',
    'RECALLED',
    'SUPERSEDED',
  ],
} as const;

const publicationOutcome = {
  enum: ['PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'],
} as const;

const publicationFailureOutcome = {
  enum: ['FAILED', 'UNKNOWN'],
} as const;

// =============================================================================
// Justification: keep parity with quality-governance / identity-policy
// =============================================================================

const justification = object(['reasonCode', 'summary', 'evidenceRefs'], {
  reasonCode,
  summary: safeSummary,
  evidenceRefs: array(evidenceRef),
  policyRef: versionedReference,
});

// =============================================================================
// Strong typed principal enforcing HUMAN_ONLY on authorize / recall
// =============================================================================

const humanOnlyPrincipal = object(['principalKind', 'principalId'], {
  principalKind: { const: 'HUMAN' },
  principalId: uuid,
});

// =============================================================================
// Reusable reference sets
// =============================================================================

const nonEmptyUniqueDestinationIds = array(uuid, { nonEmpty: true, unique: true });
const uniqueDestinationIds = array(uuid, { unique: true });
const nonEmptyUniqueContentAddressedReceiptRefs = array(contentAddressedReference, {
  nonEmpty: true,
  unique: true,
});

// =============================================================================
// Named local definitions (Module-Spec-006 §2 types)
// =============================================================================

const namedDefinitions = {
  releasePurpose,
  releaseStatus,
  publicationOutcome,
  publicationFailureOutcome,

  // --- Command submissions ------------------------------------------------
  releaseDraftDefinition: object(
    [
      'artifactRef',
      'revisionRef',
      'releaseNumber',
      'purpose',
      'qualityProfileRef',
      'revisionAcceptanceSnapshotRef',
      'approvalBundleSnapshotRef',
    ],
    {
      artifactRef: objectReference,
      revisionRef: contentAddressedReference,
      releaseNumber: text,
      purpose: localRef('releasePurpose'),
      requestedEffectiveAt: instant,
      qualityProfileRef: versionedReference,
      revisionAcceptanceSnapshotRef: snapshotReference,
      approvalBundleSnapshotRef: snapshotReference,
      supersedesReleaseRef: objectReference,
    },
  ),
  releaseRepresentationSelection: object(
    ['representationRef', 'ordinal', 'displayName', 'required', 'releaseRole'],
    {
      representationRef: { $ref: `${common}representationRef` },
      ordinal: { type: 'integer', minimum: 0 },
      displayName: safeSummary,
      required: { type: 'boolean' },
      releaseRole: namespace,
    },
  ),
  releaseDestinationDefinition: object(
    [
      'destinationId',
      'destinationType',
      'destinationRef',
      'recipientScopeRef',
      'purpose',
      'required',
      'requiredReceiptKind',
      'deliveryPolicyRef',
    ],
    {
      destinationId: uuid,
      destinationType: namespace,
      destinationRef: externalReference,
      recipientScopeRef: snapshotReference,
      purpose: namespace,
      required: { type: 'boolean' },
      requiredReceiptKind: namespace,
      deliveryPolicyRef: versionedReference,
    },
  ),
  releasePackageDefinition: object(
    [
      'releaseRef',
      'canonicalRevisionRef',
      'representations',
      'destinations',
      'recipientScopeSnapshotRef',
      'approvalBundleSnapshotRef',
      'preparedAt',
      'packageHash',
    ],
    {
      releaseRef: objectReference,
      canonicalRevisionRef: contentAddressedReference,
      representations: array(localRef('releaseRepresentationSelection'), {
        nonEmpty: true,
        unique: true,
      }),
      destinations: array(localRef('releaseDestinationDefinition'), {
        nonEmpty: true,
        unique: true,
      }),
      recipientScopeSnapshotRef: snapshotReference,
      approvalBundleSnapshotRef: snapshotReference,
      preparedAt: instant,
      packageHash: contentHash,
    },
  ),
  publicationAttemptDefinition: object(
    [
      'destinationId',
      'packageRef',
      'attemptNumber',
      'stableIdempotencyKey',
      'requestedAt',
      'externalDeliveryRequestRef',
    ],
    {
      destinationId: uuid,
      packageRef: releasePackageRef,
      attemptNumber: positiveInt,
      stableIdempotencyKey: text,
      requestedAt: instant,
      externalDeliveryRequestRef: contentAddressedReference,
    },
  ),
  formalReceiptSubmission: object(
    [
      'attemptRef',
      'destinationId',
      'packageRef',
      'rawReceiptRef',
      'providerResult',
      'occurredAt',
      'receiptPayloadHash',
    ],
    {
      attemptRef: objectReference,
      destinationId: uuid,
      packageRef: releasePackageRef,
      rawReceiptRef: contentAddressedReference,
      providerResult: canonicalJson,
      occurredAt: instant,
      receiptPayloadHash: contentHash,
    },
  ),
  publicationFailureSubmission: object(
    [
      'attemptRef',
      'destinationId',
      'packageRef',
      'classification',
      'retryable',
      'outcome',
      'occurredAt',
    ],
    {
      attemptRef: objectReference,
      destinationId: uuid,
      packageRef: releasePackageRef,
      classification: reasonCode,
      retryable: { type: 'boolean' },
      outcome: localRef('publicationFailureOutcome'),
      providerRef: externalReference,
      diagnosticRef: externalReference,
      occurredAt: instant,
    },
  ),

  // --- Result views --------------------------------------------------------
  releaseView: object(
    ['releaseRef', 'aggregateVersion', 'definition', 'status', 'attemptRefs', 'receiptRefs'],
    {
      releaseRef: objectReference,
      aggregateVersion: { type: 'integer', minimum: 0 },
      definition: localRef('releaseDraftDefinition'),
      status: localRef('releaseStatus'),
      packageRef: releasePackageRef,
      releaseReadinessSnapshotRef: snapshotReference,
      authorizationRef: contentAddressedReference,
      attemptRefs: array(objectReference),
      receiptRefs: array(contentAddressedReference),
      recallRef: contentAddressedReference,
    },
  ),
  frozenPackageView: object(['packageRef', 'definition', 'packagePayloadHash', 'frozenAt'], {
    packageRef: releasePackageRef,
    definition: localRef('releasePackageDefinition'),
    packagePayloadHash: contentHash,
    frozenAt: instant,
  }),
  publicationAttemptView: object(['attemptRef', 'definition', 'outcome'], {
    attemptRef: objectReference,
    definition: localRef('publicationAttemptDefinition'),
    outcome: localRef('publicationOutcome'),
    rawReceiptRef: contentAddressedReference,
    formalReceiptRef: contentAddressedReference,
    failureRef: contentAddressedReference,
  }),
  releaseImpactView: object(
    [
      'releaseRef',
      'triggeringRefs',
      'affectedDestinations',
      'riskClassification',
      'requiredActions',
      'humanInterventionRequired',
    ],
    {
      releaseRef: objectReference,
      triggeringRefs: array(typedReference),
      affectedDestinations: array(uuid),
      riskClassification: namespace,
      requiredActions: array(namespace),
      humanInterventionRequired: { type: 'boolean' },
    },
  ),

  // --- Query result page items ---------------------------------------------
  publicationAttemptPage: object(['items', 'snapshotAt', 'sourceWatermarks'], {
    items: array(localRef('publicationAttemptView')),
    nextCursor: opaqueCursor,
    snapshotAt: instant,
    sourceWatermarks: array({ $ref: `${common}sourceWatermark` }),
  }),
  publicationReceiptPage: object(['items', 'snapshotAt', 'sourceWatermarks'], {
    items: array(contentAddressedReference),
    nextCursor: opaqueCursor,
    snapshotAt: instant,
    sourceWatermarks: array({ $ref: `${common}sourceWatermark` }),
  }),
} as const satisfies Readonly<Record<string, JsonSchema>>;

// =============================================================================
// Operation payload / result schemas
// =============================================================================

const operationSchemas = {
  'release.create_release_draft': {
    payload: object(['definition'], {
      definition: localRef('releaseDraftDefinition'),
    }),
  },
  'release.select_representations': {
    payload: object(['selections', 'selectionReason'], {
      selections: array(localRef('releaseRepresentationSelection'), {
        nonEmpty: true,
        unique: true,
      }),
      selectionReason: justification,
    }),
  },
  'release.set_destinations': {
    payload: object(['destinations', 'recipientScopeSnapshotRef'], {
      destinations: array(localRef('releaseDestinationDefinition'), {
        nonEmpty: true,
        unique: true,
      }),
      recipientScopeSnapshotRef: snapshotReference,
    }),
  },
  'release.prepare_release': {
    payload: object(['package', 'preparationValidationRef'], {
      package: localRef('releasePackageDefinition'),
      preparationValidationRef: contentAddressedReference,
    }),
  },
  'release.validate_release_readiness': {
    payload: object(['releaseReadinessSnapshotRef', 'validatedPackageRef', 'validatedAt'], {
      releaseReadinessSnapshotRef: snapshotReference,
      validatedPackageRef: releasePackageRef,
      validatedAt: instant,
    }),
  },
  'release.authorize_release': {
    payload: object(
      [
        'releaseReadinessSnapshotRef',
        'authorizingHumanRef',
        'actorSnapshotRef',
        'authorizationDecisionRef',
        'authorizedAt',
      ],
      {
        releaseReadinessSnapshotRef: snapshotReference,
        authorizingHumanRef: humanOnlyPrincipal,
        actorSnapshotRef: snapshotReference,
        authorizationDecisionRef: contentAddressedReference,
        authorizedAt: instant,
      },
    ),
  },
  'release.start_publication_attempt': {
    payload: object(['attempt'], {
      attempt: localRef('publicationAttemptDefinition'),
    }),
  },
  'release.record_publication_receipt': {
    payload: object(['receipt'], {
      receipt: localRef('formalReceiptSubmission'),
    }),
  },
  'release.record_publication_failure': {
    payload: object(['failure'], {
      failure: localRef('publicationFailureSubmission'),
    }),
  },
  'release.complete_release': {
    payload: object(['completionPolicyRef', 'destinationOutcomeRefs', 'evaluatedAt'], {
      completionPolicyRef: versionedReference,
      destinationOutcomeRefs: array(typedReference, { nonEmpty: true, unique: true }),
      evaluatedAt: instant,
    }),
  },
  'release.recall_release': {
    payload: object(
      [
        'recallScope',
        'recallReason',
        'authorizingHumanRef',
        'authorizationDecisionRef',
        'notificationPolicyRef',
        'recalledAt',
      ],
      {
        recallScope: canonicalJson,
        recallReason: justification,
        authorizingHumanRef: humanOnlyPrincipal,
        authorizationDecisionRef: contentAddressedReference,
        notificationPolicyRef: versionedReference,
        recalledAt: instant,
      },
    ),
  },
  'release.cancel_release': {
    payload: object(['cancelReason', 'cancelledAt'], {
      cancelReason: justification,
      cancelledAt: instant,
    }),
  },
  'release.get_release': {
    payload: object(['releaseRef'], {
      releaseRef: objectReference,
    }),
    result: localRef('releaseView'),
  },
  'release.get_frozen_package': {
    payload: object(['packageRef'], {
      packageRef: releasePackageRef,
    }),
    result: localRef('frozenPackageView'),
  },
  'release.get_publication_attempts': {
    payload: object(['releaseRef', 'destinationIds', 'outcomes', 'page'], {
      releaseRef: objectReference,
      destinationIds: uniqueDestinationIds,
      outcomes: array(localRef('publicationOutcome'), { unique: true }),
      page: pageRequest,
    }),
    result: localRef('publicationAttemptPage'),
  },
  'release.get_release_receipts': {
    payload: object(['releaseRef', 'destinationIds', 'page'], {
      releaseRef: objectReference,
      packageRef: releasePackageRef,
      destinationIds: uniqueDestinationIds,
      page: pageRequest,
    }),
    result: localRef('publicationReceiptPage'),
  },
  'release.get_release_impact': {
    payload: object(['releaseRef'], {
      releaseRef: objectReference,
      triggeringRef: typedReference,
    }),
    result: localRef('releaseImpactView'),
  },
  'release.ReleasePrepared': {
    payload: object(
      ['releaseRef', 'packageRef', 'revisionRef', 'approvalBundleSnapshotRef', 'destinationIds'],
      {
        releaseRef: objectReference,
        packageRef: releasePackageRef,
        revisionRef: contentAddressedReference,
        approvalBundleSnapshotRef: snapshotReference,
        destinationIds: nonEmptyUniqueDestinationIds,
      },
    ),
  },
  'release.ReleaseAuthorized': {
    payload: object(
      [
        'releaseRef',
        'packageRef',
        'releaseReadinessSnapshotRef',
        'authorizationRef',
        'authorizedAt',
      ],
      {
        releaseRef: objectReference,
        packageRef: releasePackageRef,
        releaseReadinessSnapshotRef: snapshotReference,
        authorizationRef: contentAddressedReference,
        authorizedAt: instant,
      },
    ),
  },
  'release.PublicationAttemptRequested': {
    payload: object(
      ['releaseRef', 'packageRef', 'attemptRef', 'destinationId', 'externalDeliveryRequestRef'],
      {
        releaseRef: objectReference,
        packageRef: releasePackageRef,
        attemptRef: objectReference,
        destinationId: uuid,
        externalDeliveryRequestRef: contentAddressedReference,
      },
    ),
  },
  'release.PublicationSucceeded': {
    payload: object(
      ['releaseRef', 'packageRef', 'attemptRef', 'destinationId', 'receiptRef', 'occurredAt'],
      {
        releaseRef: objectReference,
        packageRef: releasePackageRef,
        attemptRef: objectReference,
        destinationId: uuid,
        receiptRef: contentAddressedReference,
        occurredAt: instant,
      },
    ),
  },
  'release.PublicationFailed': {
    payload: object(
      ['releaseRef', 'packageRef', 'attemptRef', 'destinationId', 'outcome', 'failureRef'],
      {
        releaseRef: objectReference,
        packageRef: releasePackageRef,
        attemptRef: objectReference,
        destinationId: uuid,
        outcome: localRef('publicationFailureOutcome'),
        failureRef: contentAddressedReference,
      },
    ),
  },
  'release.ReleasePartiallyCompleted': {
    payload: object(
      [
        'releaseRef',
        'packageRef',
        'succeededDestinationIds',
        'pendingOrFailedDestinationIds',
        'evaluatedAt',
      ],
      {
        releaseRef: objectReference,
        packageRef: releasePackageRef,
        succeededDestinationIds: uniqueDestinationIds,
        pendingOrFailedDestinationIds: nonEmptyUniqueDestinationIds,
        evaluatedAt: instant,
      },
    ),
  },
  'release.ReleaseCompleted': {
    payload: object(
      ['releaseRef', 'packageRef', 'purpose', 'revisionRef', 'receiptRefs', 'completedAt'],
      {
        releaseRef: objectReference,
        packageRef: releasePackageRef,
        purpose: localRef('releasePurpose'),
        revisionRef: contentAddressedReference,
        receiptRefs: nonEmptyUniqueContentAddressedReceiptRefs,
        completedAt: instant,
      },
    ),
  },
  'release.ReleaseRecalled': {
    payload: object(
      ['releaseRef', 'packageRef', 'recallRef', 'affectedDestinationIds', 'recalledAt'],
      {
        releaseRef: objectReference,
        packageRef: releasePackageRef,
        recallRef: contentAddressedReference,
        affectedDestinationIds: nonEmptyUniqueDestinationIds,
        recalledAt: instant,
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

export const releasePublicationOperationContracts = Object.freeze(
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
  ) as Readonly<Record<string, ExecutableReleasePublicationOperationContract>>,
);

export const releasePublicationSchema = {
  $id: schemaId,
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: {
    ...namedDefinitions,
    ...operationDefinitions,
  },
} as const satisfies JsonSchema;
