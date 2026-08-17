import type { JsonSchema } from './schema-types.js';

const uuidV7Pattern = '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const namespacePattern = '^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$';
const utcInstantPattern = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$';

export const commonSchema = {
  $id: 'https://schemas.zhiju.local/common/1.0',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: {
    uuidV7: { type: 'string', pattern: uuidV7Pattern },
    namespaceCode: { type: 'string', pattern: namespacePattern },
    nonEmptyString: { type: 'string', minLength: 1, pattern: '.*\\S.*' },
    utcInstant: { type: 'string', pattern: utcInstantPattern },
    positiveInteger: { type: 'integer', minimum: 1 },
    nonNegativeInteger: { type: 'integer', minimum: 0 },
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
    typedReference: {
      type: 'object',
      required: ['kind', 'objectType', 'objectId', 'scope'],
      properties: {
        kind: {
          enum: ['OBJECT', 'VERSIONED', 'CONTENT_ADDRESSED', 'SNAPSHOT', 'EXTERNAL', 'SCHEMA'],
        },
        objectType: { $ref: '#/$defs/namespaceCode' },
        objectId: { $ref: '#/$defs/uuidV7' },
        scope: { $ref: '#/$defs/scopeRef' },
      },
    },
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
        payload: {},
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
        schemaRef: { $ref: '#/$defs/typedReference' },
        scopeRef: { $ref: '#/$defs/scopeRef' },
        issuedAt: { $ref: '#/$defs/utcInstant' },
        issuedBy: { $ref: '#/$defs/typedReference' },
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
        extensions: { type: 'array', items: { $ref: '#/$defs/extension' } },
      },
    },
  },
} as const satisfies JsonSchema;
