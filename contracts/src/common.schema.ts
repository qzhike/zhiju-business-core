import type { JsonSchema } from './schema-types.js';

// =============================================================================
// Regular expression fragments
// =============================================================================
//
// All patterns are anchored implicitly by `pattern` in JSON Schema. They follow
// the canonicalization guidance from `06-typed-references-contract-catalog-v0.1`
// and `api-contract-v0.1` (RFC 9562 UUIDv7, lowercase dotted namespaces,
// registered upper-snake reason codes, UTC RFC 3339, SHA-256 hex digests, etc.).
// =============================================================================

const uuidV7Pattern = '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const namespacePattern = '^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$';
const utcInstantPattern = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$';
const localDatePattern = '^\\d{4}-\\d{2}-\\d{2}$';
const durationPattern = '^P(?:\\d+D|\\d+W)?(?:T(?:\\d+H|\\d+M|\\d+(?:\\.\\d+)?S))?$';
const decimalStringPattern = '^-?\\d+(?:\\.\\d+)?$';
const mediaTypePattern = '^[a-z0-9.+-]+/[a-z0-9.+-]+(?:;\\s*.+=.+)?$';
const localeTagPattern = '^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$';
const safeSummaryPattern = '.*\\S.*';
const opaqueCursorPattern = '^[A-Za-z0-9_-]{16,512}$';

// =============================================================================
// Shared scalar value objects (`04 共享标量与 Value Object` of API-Contract v0.1)
// =============================================================================

const scalars = {
  uuidV7: { type: 'string', pattern: uuidV7Pattern },
  namespaceCode: { type: 'string', pattern: namespacePattern },
  reasonCode: { type: 'string', pattern: '^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$' },
  nonEmptyString: { type: 'string', minLength: 1, pattern: safeSummaryPattern },
  safeSummary: { type: 'string', minLength: 1, pattern: safeSummaryPattern },
  utcInstant: { type: 'string', pattern: utcInstantPattern },
  localDate: { type: 'string', pattern: localDatePattern },
  duration: { type: 'string', pattern: durationPattern },
  decimalString: { type: 'string', pattern: decimalStringPattern },
  mediaType: { type: 'string', pattern: mediaTypePattern },
  localeTag: { type: 'string', pattern: localeTagPattern },
  opaqueCursor: { type: 'string', pattern: opaqueCursorPattern },
  positiveInteger: { type: 'integer', minimum: 1 },
  nonNegativeInteger: { type: 'integer', minimum: 0 },
  currencyCode: { type: 'string', pattern: '^[A-Z]{3}$' },
} as const;

// =============================================================================
// `Page<T>` payload — items are intentionally open because the generic argument
// is resolved by the surrounding Query Result schema. Open JSON here is
// justified by `API-Contract v0.1 §4 Page<T>` and `06 §8.4 QueryResult<T>`.
// =============================================================================

function openJson(reason: string): JsonSchema {
  return { description: reason };
}

// =============================================================================
// Common schema registry
// =============================================================================
//
// All `$defs` defined here are consumed by `core.schema.ts`, `envelopes.schema.ts`
// and the per-module operation schemas via `https://schemas.zhiju.local/common/1.0#/$defs/<name>`.
// Cross-cutting references (`EvidenceRef`, `Justification`, `EffectivePeriod`,
// `SourceWatermark`, `Page`, `PrincipalRef`, `ActorSnapshotRef`) are unified here
// so that the Core Contracts and the seven module payloads stop maintaining
// semantically duplicated definitions (Issue #1 acceptance criterion #3).
// =============================================================================

export const commonSchema = {
  $id: 'https://schemas.zhiju.local/common/1.0',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: {
    // --- Scalars -----------------------------------------------------------
    ...scalars,

    // --- Content integrity -------------------------------------------------
    contentHash: {
      type: 'object',
      additionalProperties: false,
      required: ['algorithm', 'digest', 'canonicalizationVersion'],
      properties: {
        algorithm: { const: 'SHA-256' },
        digest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        canonicalizationVersion: { const: '1' },
      },
    },

    // --- Scope and the five flavours of typed reference --------------------
    scopeRef: {
      type: 'object',
      additionalProperties: false,
      dependentRequired: { projectId: ['enterpriseId'] },
      properties: {
        enterpriseId: { $ref: '#/$defs/uuidV7' },
        projectId: { $ref: '#/$defs/uuidV7' },
      },
    },

    objectRef: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'objectType', 'objectId', 'scope'],
      properties: {
        kind: { const: 'OBJECT' },
        objectType: { $ref: '#/$defs/namespaceCode' },
        objectId: { $ref: '#/$defs/uuidV7' },
        scope: { $ref: '#/$defs/scopeRef' },
      },
    },

    versionedRef: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'objectType', 'objectId', 'versionId', 'scope'],
      properties: {
        kind: { const: 'VERSIONED' },
        objectType: { $ref: '#/$defs/namespaceCode' },
        objectId: { $ref: '#/$defs/uuidV7' },
        versionId: { $ref: '#/$defs/uuidV7' },
        scope: { $ref: '#/$defs/scopeRef' },
      },
    },

    contentAddressedRef: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'objectType', 'objectId', 'scope', 'contentHash'],
      properties: {
        kind: { const: 'CONTENT_ADDRESSED' },
        objectType: { $ref: '#/$defs/namespaceCode' },
        objectId: { $ref: '#/$defs/uuidV7' },
        immutableVersionId: { $ref: '#/$defs/uuidV7' },
        scope: { $ref: '#/$defs/scopeRef' },
        contentHash: { $ref: '#/$defs/contentHash' },
      },
    },

    snapshotRef: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'objectType', 'objectId', 'snapshotId', 'scope', 'contentHash'],
      properties: {
        kind: { const: 'SNAPSHOT' },
        objectType: { $ref: '#/$defs/namespaceCode' },
        objectId: { $ref: '#/$defs/uuidV7' },
        snapshotId: { $ref: '#/$defs/uuidV7' },
        scope: { $ref: '#/$defs/scopeRef' },
        contentHash: { $ref: '#/$defs/contentHash' },
      },
    },

    externalRef: {
      type: 'object',
      additionalProperties: false,
      required: ['system', 'resourceType', 'externalId', 'observedAt'],
      properties: {
        system: { $ref: '#/$defs/namespaceCode' },
        tenantOrAccountRef: { $ref: '#/$defs/objectRef' },
        resourceType: { $ref: '#/$defs/namespaceCode' },
        externalId: { $ref: '#/$defs/nonEmptyString' },
        observedAt: { $ref: '#/$defs/utcInstant' },
        payloadHash: { $ref: '#/$defs/contentHash' },
        adapterVersion: { $ref: '#/$defs/nonEmptyString' },
      },
    },

    typedReference: {
      oneOf: [
        { $ref: '#/$defs/objectRef' },
        { $ref: '#/$defs/versionedRef' },
        { $ref: '#/$defs/contentAddressedRef' },
        { $ref: '#/$defs/snapshotRef' },
        { $ref: '#/$defs/externalRef' },
      ],
    },

    // --- Strong typed references used by Quality / Release contracts ------
    // `06 §3.6 EvidenceRef`, `3.7 RepresentationRef`, `3.8 ReleasePackageRef`
    evidenceRef: {
      type: 'object',
      additionalProperties: false,
      required: ['evidence', 'relation'],
      properties: {
        evidence: { $ref: '#/$defs/contentAddressedRef' },
        evidenceLinkRef: { $ref: '#/$defs/objectRef' },
        relation: { enum: ['SUPPORTS', 'CONTRADICTS', 'CONTEXT_ONLY'] },
        targetClaimRef: {
          type: 'object',
          additionalProperties: false,
          required: ['target', 'claimLocator', 'claimHash'],
          properties: {
            target: { $ref: '#/$defs/contentAddressedRef' },
            claimLocator: { $ref: '#/$defs/nonEmptyString' },
            claimHash: { $ref: '#/$defs/contentHash' },
          },
        },
        applicabilityScopeRef: { $ref: '#/$defs/scopeRef' },
      },
    },

    representationRef: {
      type: 'object',
      additionalProperties: false,
      required: [
        'representationId',
        'revision',
        'format',
        'mediaType',
        'objectStorageRef',
        'checksum',
        'renderer',
        'createdAt',
      ],
      properties: {
        representationId: { $ref: '#/$defs/uuidV7' },
        revision: { $ref: '#/$defs/contentAddressedRef' },
        format: { $ref: '#/$defs/namespaceCode' },
        mediaType: { $ref: '#/$defs/mediaType' },
        objectStorageRef: { $ref: '#/$defs/nonEmptyString' },
        checksum: { $ref: '#/$defs/contentHash' },
        renderer: {
          type: 'object',
          additionalProperties: false,
          required: ['rendererId', 'rendererVersion'],
          properties: {
            rendererId: { $ref: '#/$defs/namespaceCode' },
            rendererVersion: { $ref: '#/$defs/nonEmptyString' },
          },
        },
        createdAt: { $ref: '#/$defs/utcInstant' },
      },
    },

    releasePackageRef: {
      type: 'object',
      additionalProperties: false,
      required: ['releaseRef', 'packageSnapshotRef', 'packageHash'],
      properties: {
        releaseRef: { $ref: '#/$defs/objectRef' },
        packageSnapshotRef: { $ref: '#/$defs/snapshotRef' },
        packageHash: { $ref: '#/$defs/contentHash' },
      },
    },

    // --- Principal / Actor references (`06 §3.9`) -------------------------
    principalRef: {
      type: 'object',
      additionalProperties: false,
      required: ['principalKind', 'principalId'],
      properties: {
        principalKind: {
          enum: ['HUMAN', 'AGENT', 'SERVICE', 'RUNTIME', 'EXTERNAL_PARTY'],
        },
        principalId: { $ref: '#/$defs/uuidV7' },
      },
    },

    actorSnapshotRef: {
      type: 'object',
      additionalProperties: false,
      required: ['principalRef'],
      properties: {
        principalRef: { $ref: '#/$defs/principalRef' },
        roleSnapshotRef: { $ref: '#/$defs/objectRef' },
        actingForRef: { $ref: '#/$defs/principalRef' },
      },
    },

    // --- Provenance / Justification / Effective Period ----------------------
    // `API-Contract v0.1 §4 Justification`, `EffectivePeriod`,
    // `SourceWatermark`, `Page<T>`, `FieldViolation`
    justification: {
      type: 'object',
      additionalProperties: false,
      required: ['reasonCode', 'summary'],
      properties: {
        reasonCode: { $ref: '#/$defs/reasonCode' },
        summary: { $ref: '#/$defs/safeSummary' },
        evidenceRefs: {
          type: 'array',
          items: { $ref: '#/$defs/evidenceRef' },
          uniqueItems: true,
        },
        policyRef: { $ref: '#/$defs/versionedRef' },
      },
    },

    effectivePeriod: {
      type: 'object',
      additionalProperties: false,
      properties: {
        validFrom: { $ref: '#/$defs/utcInstant' },
        validTo: { $ref: '#/$defs/utcInstant' },
      },
    },

    sourceWatermark: {
      type: 'object',
      additionalProperties: false,
      required: ['sourceModule', 'sequence', 'observedAt'],
      properties: {
        sourceModule: { $ref: '#/$defs/namespaceCode' },
        partition: { $ref: '#/$defs/nonEmptyString' },
        sequence: { $ref: '#/$defs/nonNegativeInteger' },
        observedAt: { $ref: '#/$defs/utcInstant' },
      },
    },

    pageRequest: {
      type: 'object',
      additionalProperties: false,
      required: ['pageSize'],
      properties: {
        pageSize: { $ref: '#/$defs/positiveInteger' },
        cursor: { $ref: '#/$defs/opaqueCursor' },
      },
    },

    // `Page<T>` is intentionally generic. The owning schema (e.g. a Query
    // Result schema in a module Spec) declares the concrete item type by
    // referencing this definition together with a per-module `items` override
    // through `$ref` composition. Until `06` §8.4 is formalized as a generic
    // JSON Schema generator, items are kept as `CanonicalJson` (open JSON)
    // because the type parameter `T` is supplied via the surrounding schema.
    page: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'snapshotAt', 'sourceWatermarks'],
      properties: {
        items: { type: 'array', items: openJson('Page items = T (CanonicalJson per 06 §8.4)') },
        nextCursor: { $ref: '#/$defs/opaqueCursor' },
        snapshotAt: { $ref: '#/$defs/utcInstant' },
        sourceWatermarks: {
          type: 'array',
          items: { $ref: '#/$defs/sourceWatermark' },
          uniqueItems: true,
        },
      },
    },

    fieldViolation: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'violatedRule'],
      properties: {
        code: { $ref: '#/$defs/reasonCode' },
        fieldPath: { $ref: '#/$defs/nonEmptyString' },
        violatedRule: { $ref: '#/$defs/nonEmptyString' },
        safeDetail: { $ref: '#/$defs/safeSummary' },
        targetRef: { $ref: '#/$defs/typedReference' },
      },
    },

    // --- Value Presence / Value Envelope (`06 §6.2`) -----------------------
    // `value` is open JSON because `ValueEnvelope<T>` accepts arbitrary typed
    // payloads per the same catalog entry. Producers must tag the runtime
    // contract via `dataClassification` upstream rather than via `value` typing.
    //
    // The `presence=PRESENT ⇒ value required` rule and its inverse are part of
    // structural validation. The conditional repeats the `value` property in
    // `then` so Ajv strictRequired can prove that the required key is declared.
    valueEnvelope: {
      type: 'object',
      additionalProperties: false,
      required: ['presence'],
      properties: {
        presence: {
          enum: ['PRESENT', 'UNKNOWN', 'REDACTED', 'NOT_APPLICABLE', 'UNAVAILABLE'],
        },
        value: openJson(
          'Open JSON per 06 §6.2 ValueEnvelope<T> generic argument. Application layer must require value when presence=PRESENT and forbid non-empty value for other Presence states.',
        ),
        reasonCode: { $ref: '#/$defs/reasonCode' },
        evidenceRefs: {
          type: 'array',
          items: { $ref: '#/$defs/evidenceRef' },
          uniqueItems: true,
        },
        lastVerifiedAt: { $ref: '#/$defs/utcInstant' },
      },
      allOf: [
        {
          if: {
            properties: { presence: { const: 'PRESENT' } },
            required: ['presence'],
          },
          then: {
            properties: {
              value: openJson('ValueEnvelope<T> generic argument per 06 §6.2.'),
            },
            required: ['value'],
          },
          else: {
            properties: { value: false },
          },
        },
      ],
    },

    // --- Integrality of envelope-level integrity --------------------------
    integrity: {
      type: 'object',
      additionalProperties: false,
      required: ['canonicalizationVersion', 'payloadHash'],
      properties: {
        canonicalizationVersion: { const: '1' },
        payloadHash: { $ref: '#/$defs/contentHash' },
      },
    },

    extension: {
      type: 'object',
      additionalProperties: false,
      required: ['extensionType', 'extensionVersion', 'required', 'payload'],
      properties: {
        extensionType: { $ref: '#/$defs/namespaceCode' },
        extensionVersion: { type: 'string', pattern: '^\\d+\\.\\d+$' },
        required: { type: 'boolean' },
        // `payload` is open per `06 §7 ContractHeader.extensions.payload`:
        // the registered Extension Type schema enforces structure at the
        // application layer; JSON Schema cannot dispatch on extensionType.
        payload: openJson(
          'Open CanonicalJson per 06 §7 (extensions.payload); schema enforced by Extension Type registry.',
        ),
      },
    },

    contractHeader: {
      type: 'object',
      additionalProperties: false,
      required: [
        'contractId',
        'contractType',
        'contractVersion',
        'schemaRef',
        'scopeRef',
        'issuedAt',
        'issuedBy',
        'correlationId',
        'dataClassification',
        'canonicalizationVersion',
        'payloadHash',
      ],
      properties: {
        contractId: { $ref: '#/$defs/uuidV7' },
        contractType: { $ref: '#/$defs/namespaceCode' },
        contractVersion: { const: '1.0' },
        schemaRef: { $ref: '#/$defs/versionedRef' },
        scopeRef: { $ref: '#/$defs/scopeRef' },
        issuedAt: { $ref: '#/$defs/utcInstant' },
        issuedBy: { $ref: '#/$defs/principalRef' },
        correlationId: { $ref: '#/$defs/uuidV7' },
        causationId: { $ref: '#/$defs/uuidV7' },
        dataClassification: {
          enum: [
            'PUBLIC_AUTHORITY',
            'INTERNAL',
            'CUSTOMER_CONFIDENTIAL',
            'RESTRICTED_PERSONAL',
            'REGULATED',
          ],
        },
        canonicalizationVersion: { const: '1' },
        payloadHash: { $ref: '#/$defs/contentHash' },
        extensions: {
          type: 'array',
          items: { $ref: '#/$defs/extension' },
          uniqueItems: true,
        },
      },
    },

    // --- Closed enums reused across Core Contracts ------------------------
    referenceStrength: {
      enum: ['OBJECT', 'VERSIONED', 'CONTENT_ADDRESSED', 'SNAPSHOT'],
    },
    projectionType: {
      enum: [
        'COORDINATOR',
        'DOCUMENT_WRITER',
        'REVIEWER',
        'RECORD_FORM_BUILDER',
        'FEISHU_SUMMARY',
        'HUMAN_WORKSPACE',
      ],
    },
    contextItemKind: {
      enum: [
        'FACT',
        'DECISION',
        'MATERIAL',
        'REQUIREMENT',
        'EVIDENCE',
        'DELIVERY_COMMITMENT',
        'BLOCKER',
        'MEMORY',
      ],
    },
    epistemicState: {
      enum: ['CONFIRMED', 'INFERRED', 'UNKNOWN', 'DISPUTED', 'SUPERSEDED'],
    },
    coverageCompleteness: {
      enum: ['COMPLETE_FOR_PURPOSE', 'PARTIAL', 'BLOCKED'],
    },
    inputContentAccessMode: {
      enum: ['REFERENCE_ONLY', 'INLINE_FRAGMENT', 'AUTHORIZED_FETCH'],
    },
    outputCardinality: {
      enum: ['EXACTLY_ONE', 'ZERO_OR_ONE', 'AT_LEAST_ONE', 'ANY'],
    },
    executionOutcome: {
      enum: [
        'COMPLETED',
        'PARTIAL',
        'BLOCKED_INPUT',
        'BLOCKED_POLICY',
        'FAILED_EXECUTION',
        'CANCELLED_BY_RUNTIME',
      ],
    },
    findingSeverity: {
      enum: ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    },
    findingDisposition: {
      enum: ['ACCEPT', 'INVESTIGATE', 'DEFER', 'REJECT'],
    },
    readinessStatus: {
      enum: ['READY', 'NOT_READY', 'STALE'],
    },
    approvalCompletenessStatus: {
      enum: ['FULLY_APPROVED', 'PARTIALLY_APPROVED', 'NOT_APPROVED', 'STALE'],
    },
    releaseReadinessStatus: {
      enum: ['READY_FOR_AUTHORIZATION', 'NOT_READY', 'STALE'],
    },
    evaluationStage: {
      enum: ['REVISION_ACCEPTANCE', 'APPROVAL', 'RELEASE_READINESS'],
    },
    separationOfDutiesOutcome: {
      enum: ['SATISFIED', 'VIOLATED', 'INDETERMINATE'],
    },
  },
} as const satisfies JsonSchema;
