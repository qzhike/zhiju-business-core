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
const nonNegativeInt = { type: 'integer', minimum: 0 } as const;
const representationReference = { $ref: `${common}representationRef` } as const;

// =============================================================================
// D12 / Q11 project-delivery reference narrowing (#272)
// =============================================================================
//
// `Common.scopeRef` leaves both Scope members optional, so every D12
// Project-owned reference is narrowed explicitly, exactly like
// `task-execution.schema.ts` narrows its Context / Task-readiness snapshots.
// Enterprise-owned Profile/Policy references keep their own legal Scope instead
// of copying the Project rule.

const projectScope = {
  type: 'object',
  required: ['enterpriseId', 'projectId'],
  properties: { enterpriseId: uuid, projectId: uuid },
} as const;

/**
 * Enterprise-scoped aggregates (`quality.quality_profile`) cannot carry a
 * projectId: the owning module rejects Project scope and its migration enforces
 * `project_id IS NULL`.
 */
const enterpriseOnlyScope = {
  type: 'object',
  additionalProperties: false,
  required: ['enterpriseId'],
  properties: { enterpriseId: uuid },
} as const;

/**
 * Policy versions require `enterpriseId`; `projectId` stays an owning-resolution
 * fact because the Policy version decides which Scope form is legal.
 */
const enterpriseScope = {
  type: 'object',
  required: ['enterpriseId'],
  properties: { enterpriseId: uuid, projectId: uuid },
} as const;

function scopedReference(
  reference: JsonSchema,
  objectType: string | undefined,
  scope: unknown,
): JsonSchema {
  return {
    allOf: [
      reference,
      {
        type: 'object',
        properties: {
          ...(objectType === undefined ? {} : { objectType: { const: objectType } }),
          scope,
        },
      },
    ],
  };
}

function projectReference(reference: JsonSchema, objectType: string): JsonSchema {
  return scopedReference(reference, objectType, projectScope);
}

/** Policy versions keep the owning registered spelling and their enterprise Scope. */
const policyReference = scopedReference(
  versionedReference,
  'zhiju.identity.policy',
  enterpriseScope,
);

/**
 * Project-scoped snapshot whose `objectType` stays an owning-resolution fact.
 * The shared `scopeRef` leaves both members optional, so the D12 first version
 * pins the Scope it actually requires.
 */
const projectScopedSnapshotReference = scopedReference(snapshotReference, undefined, projectScope);

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

  // --- D12 / Q11 project-delivery immutable contract (#272) -----------------
  //
  // Closed types for the ReleasePublication-owned immutable project-delivery
  // contract approved in Module-Spec-006 §14.2. Publishing these definitions
  // registers the type/identity surface only: it creates no business object,
  // registers no public operation and makes no unimplemented D12 handler
  // callable. Every embedded reference keeps its owning module's registered
  // `objectType` and legal Scope.
  projectDeliveryManifestVersion: { const: 'project-delivery-batch-manifest/1.0' },
  projectDeliveryArchiveDescriptorVersion: { const: 'project-delivery-archive/1.0' },
  projectDeliveryZipProfileVersion: { const: 'project-delivery-zip/1.0' },
  projectDeliveryExportMediaType: { const: 'application/zip' },
  projectDeliveryRepresentationFormat: { const: 'document.markdown' },
  projectDeliveryRepresentationMediaType: { const: 'text/markdown' },
  projectDeliveryBatchStatus: { enum: ['CONFIRMED'] },
  projectDeliveryCurrentUseStatus: { enum: ['USABLE', 'BLOCKED', 'UNKNOWN'] },
  projectDeliveryArchiveValidationOutcome: { enum: ['VERIFIED'] },

  /** Opaque controlled-object-storage locator (mirrors the artifact / IG pattern). */
  objectLocator: {
    type: 'string',
    pattern: '^[a-z0-9][a-z0-9._-]*(?:/[A-Za-z0-9._-]+)+$',
  },

  projectDeliveryChapterBinding: object(['chapterCode', 'ordinal'], {
    chapterCode: namespace,
    ordinal: nonNegativeInt,
  }),
  projectDeliveryEntryChecksum: object(['archivePath', 'checksum'], {
    archivePath: text,
    checksum: contentHash,
  }),

  /**
   * Reuses the Artifact-owned `RevisionProvenance` definition rather than
   * restating its eleven fields: the entry stores the exact provenance of the
   * immutable Artifact Revision it packages.
   */
  revisionProvenance: {
    $ref: 'https://schemas.zhiju.local/modules/artifact/1.0#/$defs/revisionProvenance',
  },
  projectDeliveryProvenance: object(['revisionProvenance', 'sourceReportRefs'], {
    revisionProvenance: localRef('revisionProvenance'),
    // EnterpriseProject-owned accepted report snapshots. The D14 report
    // `objectType` is still an unregistered proposal, so the first version
    // pins the snapshot shape and accepts the legitimate empty collection
    // instead of inventing a selector.
    sourceReportRefs: array(snapshotReference, { unique: true }),
  }),

  projectDeliveryDependencyProof: object(
    ['ruleRefs', 'requiredItemIds', 'coveredItemIds', 'associationSetHash', 'requirementSetHash'],
    {
      // Only real Policy versions, including the Plan quality Policy and the
      // export Policy: a QualityProfile is not a Policy and cannot stand in.
      ruleRefs: array(policyReference, { nonEmpty: true, unique: true }),
      requiredItemIds: array(uuid, { unique: true }),
      coveredItemIds: array(uuid, { unique: true }),
      associationSetHash: contentHash,
      requirementSetHash: contentHash,
    },
  ),

  /**
   * `RepresentationRef` with its nested Revision pinned to the owning spelling
   * and the D12 Markdown-only boundary: the first version packages one
   * registered Markdown representation per Artifact and performs no
   * DOCX/XLSX/PDF conversion.
   */
  projectDeliveryRepresentationRef: {
    allOf: [
      representationReference,
      {
        type: 'object',
        properties: {
          revision: projectReference(contentAddressedReference, 'artifact.artifact_revision'),
          format: localRef('projectDeliveryRepresentationFormat'),
          mediaType: localRef('projectDeliveryRepresentationMediaType'),
        },
      },
    ],
  },
  projectDeliveryReleasePackageRef: {
    allOf: [
      releasePackageRef,
      {
        type: 'object',
        properties: {
          releaseRef: projectReference(objectReference, 'release.release'),
          packageSnapshotRef: projectReference(snapshotReference, 'release.release_package'),
        },
      },
    ],
  },

  projectDeliveryEntry: object(
    [
      'artifactRef',
      'revisionRef',
      'representationRef',
      'deliveryItemIds',
      'associationProofHash',
      'chapterBindings',
      'provenance',
      'qualityProfileRef',
      'revisionAcceptanceSnapshotRef',
      'approvalBundleSnapshotRef',
      'releaseRef',
      'releasePackageRef',
      'releaseReadinessSnapshotRef',
      'releaseAuthorizationRef',
      'archivePath',
    ],
    {
      artifactRef: projectReference(objectReference, 'artifact.artifact'),
      revisionRef: projectReference(contentAddressedReference, 'artifact.artifact_revision'),
      representationRef: localRef('projectDeliveryRepresentationRef'),
      deliveryItemIds: array(uuid, { nonEmpty: true, unique: true }),
      associationProofHash: contentHash,
      chapterBindings: array(localRef('projectDeliveryChapterBinding'), {
        nonEmpty: true,
        unique: true,
      }),
      provenance: localRef('projectDeliveryProvenance'),
      qualityProfileRef: scopedReference(
        versionedReference,
        'quality.quality_profile',
        enterpriseOnlyScope,
      ),
      revisionAcceptanceSnapshotRef: projectReference(
        snapshotReference,
        'quality.revision_acceptance_snapshot',
      ),
      approvalBundleSnapshotRef: projectReference(
        snapshotReference,
        'quality.approval_bundle_snapshot',
      ),
      releaseRef: projectReference(objectReference, 'release.release'),
      releasePackageRef: localRef('projectDeliveryReleasePackageRef'),
      releaseReadinessSnapshotRef: projectReference(
        snapshotReference,
        'quality.release_readiness_snapshot',
      ),
      releaseAuthorizationRef: projectReference(
        contentAddressedReference,
        'release.release_authorization',
      ),
      archivePath: text,
    },
  ),

  projectDeliveryManifest: object(
    [
      'manifestVersion',
      'batchRef',
      'projectRef',
      'deliveryPlanRef',
      'recipientScopeSnapshotRef',
      'destinations',
      'exportPolicyRef',
      'dependencyProof',
      'entries',
    ],
    {
      manifestVersion: localRef('projectDeliveryManifestVersion'),
      batchRef: projectReference(objectReference, 'release.project_delivery_batch'),
      projectRef: projectReference(objectReference, 'zhiju.project.project'),
      deliveryPlanRef: projectReference(versionedReference, 'zhiju.project.delivery_plan'),
      // The RecipientScope snapshot has two competing in-repo spellings and no
      // registered `const`, so the first version pins the reference kind and the
      // structural Project Scope and leaves the exact `objectType` to the owning
      // resolution instead of fabricating a selector.
      recipientScopeSnapshotRef: projectScopedSnapshotReference,
      destinations: array(localRef('releaseDestinationDefinition'), {
        nonEmpty: true,
        unique: true,
      }),
      exportPolicyRef: policyReference,
      dependencyProof: localRef('projectDeliveryDependencyProof'),
      entries: array(localRef('projectDeliveryEntry'), { nonEmpty: true, unique: true }),
    },
  ),

  projectDeliveryBatchRef: projectReference(
    contentAddressedReference,
    'release.project_delivery_batch',
  ),
  projectDeliveryCurrentUse: object(['status', 'reasonCodes', 'checkedAt', 'sourceWatermarks'], {
    status: localRef('projectDeliveryCurrentUseStatus'),
    reasonCodes: array(reasonCode),
    checkedAt: instant,
    sourceWatermarks: array({ $ref: `${common}sourceWatermark` }),
  }),
  projectDeliveryBatchView: object(
    [
      'batchRef',
      'manifest',
      'status',
      'confirmedAt',
      'confirmingActorSnapshotRef',
      'confirmingAuthorizationDecisionRef',
      'confirmationReceiptRef',
      'generationRequestRefs',
      'currentUse',
    ],
    {
      batchRef: localRef('projectDeliveryBatchRef'),
      manifest: localRef('projectDeliveryManifest'),
      status: localRef('projectDeliveryBatchStatus'),
      confirmedAt: instant,
      // Confirmation attribution. Their object types stay owning-resolution
      // facts: IdentityPolicy publishes no registered actor-snapshot spelling in
      // this contract family.
      confirmingActorSnapshotRef: snapshotReference,
      confirmingAuthorizationDecisionRef: contentAddressedReference,
      confirmationReceiptRef: contentAddressedReference,
      generationRequestRefs: array(
        projectReference(objectReference, 'release.project_delivery_package_request'),
      ),
      currentUse: localRef('projectDeliveryCurrentUse'),
    },
  ),

  projectDeliveryArchiveRef: projectReference(
    contentAddressedReference,
    'release.project_delivery_archive',
  ),
  projectDeliveryArchiveDescriptor: object(
    [
      'descriptorVersion',
      'archiveRef',
      'batchRef',
      'batchManifestHash',
      'manifestMarkdownChecksum',
      'zipChecksum',
      'entryChecksums',
      'zipByteSize',
      'mediaType',
      'objectRef',
      'storageVersion',
      'archiveProfileVersion',
      'validationFactRef',
      'linkedAt',
      'availableAt',
    ],
    {
      descriptorVersion: localRef('projectDeliveryArchiveDescriptorVersion'),
      // OBJECT archive identity: the descriptor must not embed its own
      // CONTENT_ADDRESSED `ProjectDeliveryArchiveRef` or its own hash.
      archiveRef: projectReference(objectReference, 'release.project_delivery_archive'),
      batchRef: localRef('projectDeliveryBatchRef'),
      batchManifestHash: contentHash,
      manifestMarkdownChecksum: contentHash,
      zipChecksum: contentHash,
      entryChecksums: array(localRef('projectDeliveryEntryChecksum'), {
        nonEmpty: true,
        unique: true,
      }),
      zipByteSize: nonNegativeInt,
      mediaType: localRef('projectDeliveryExportMediaType'),
      objectRef: localRef('objectLocator'),
      storageVersion: text,
      archiveProfileVersion: localRef('projectDeliveryZipProfileVersion'),
      validationFactRef: projectReference(
        contentAddressedReference,
        'release.project_delivery_archive_validation',
      ),
      linkedAt: instant,
      availableAt: instant,
    },
  ),
  projectDeliveryArchiveValidation: object(
    [
      'attemptRef',
      'batchRef',
      'objectRef',
      'storageVersion',
      'archiveProfileVersion',
      'entryChecksums',
      'manifestMarkdownChecksum',
      'zipChecksum',
      'zipByteSize',
      'outcome',
      'validatorVersion',
      'validatedAt',
    ],
    {
      attemptRef: projectReference(objectReference, 'release.project_delivery_export_attempt'),
      batchRef: localRef('projectDeliveryBatchRef'),
      objectRef: localRef('objectLocator'),
      storageVersion: text,
      archiveProfileVersion: localRef('projectDeliveryZipProfileVersion'),
      entryChecksums: array(localRef('projectDeliveryEntryChecksum'), {
        nonEmpty: true,
        unique: true,
      }),
      manifestMarkdownChecksum: contentHash,
      zipChecksum: contentHash,
      zipByteSize: nonNegativeInt,
      outcome: localRef('projectDeliveryArchiveValidationOutcome'),
      validatorVersion: text,
      validatedAt: instant,
    },
  ),
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
