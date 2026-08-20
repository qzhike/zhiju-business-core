import type { JsonSchema, PublicOperationDefinition } from './schema-types.js';

const common = 'https://schemas.zhiju.local/common/1.0#/$defs/';

// Keep this helper local and type-import-only so tooling can load this module
// under Node `--experimental-strip-types` without resolving compiled `.js`
// value imports. Behavior must match `operationPayloadSchemaRef` in
// `schema-types.ts` (enforced by contracts envelope parity tests).
function payloadSchemaRef(operation: PublicOperationDefinition): string | undefined {
  if (operation.schemaStatus !== 'FULL') return undefined;
  return `https://schemas.zhiju.local/modules/${operation.owner}/1.0#/$defs/${operation.type.replaceAll('.', '_')}_payload`;
}

function payloadSchema(operation: PublicOperationDefinition): JsonSchema {
  const schemaRef = payloadSchemaRef(operation);
  return schemaRef === undefined ? { type: 'object' } : { $ref: schemaRef };
}

function commandSchema(operation: PublicOperationDefinition): JsonSchema {
  return {
    $id: `https://schemas.zhiju.local/api/1.0/${operation.type}`,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: [
      'commandId',
      'commandType',
      'commandVersion',
      'scopeRef',
      'targetRef',
      'actor',
      'authorizationDecisionRef',
      'idempotencyKey',
      'correlationId',
      'requestedAt',
      'payload',
      'integrity',
    ],
    properties: {
      commandId: { $ref: `${common}uuidV7` },
      commandType: { const: operation.type },
      commandVersion: { const: operation.version },
      scopeRef: { $ref: `${common}scopeRef` },
      targetRef: { $ref: `${common}objectRef` },
      expectedAggregateVersion: { type: 'integer', minimum: 0 },
      actor: { $ref: `${common}typedReference` },
      authorizationDecisionRef: { $ref: `${common}typedReference` },
      idempotencyKey: { $ref: `${common}nonEmptyString` },
      correlationId: { $ref: `${common}uuidV7` },
      causationId: { $ref: `${common}uuidV7` },
      requestedAt: { $ref: `${common}utcInstant` },
      deadline: { $ref: `${common}utcInstant` },
      payload: payloadSchema(operation),
      integrity: { $ref: `${common}integrity` },
    },
  };
}

function querySchema(operation: PublicOperationDefinition): JsonSchema {
  return {
    $id: `https://schemas.zhiju.local/api/1.0/${operation.type}`,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: [
      'queryId',
      'queryType',
      'queryVersion',
      'scopeRef',
      'requester',
      'authenticationContextRef',
      'consistencyRequirement',
      'correlationId',
      'requestedAt',
      'payload',
    ],
    properties: {
      queryId: { $ref: `${common}uuidV7` },
      queryType: { const: operation.type },
      queryVersion: { const: operation.version },
      scopeRef: { $ref: `${common}scopeRef` },
      requester: { $ref: `${common}typedReference` },
      authenticationContextRef: { $ref: `${common}typedReference` },
      authorizationDecisionRef: { $ref: `${common}typedReference` },
      consistencyRequirement: {
        enum: ['AUTHORITATIVE', 'SNAPSHOT_AT_LEAST', 'PROJECTION_OK'],
      },
      minimumWatermark: { type: 'integer', minimum: 0 },
      asOf: { $ref: `${common}utcInstant` },
      pagination: { type: 'object' },
      correlationId: { $ref: `${common}uuidV7` },
      requestedAt: { $ref: `${common}utcInstant` },
      payload: payloadSchema(operation),
    },
  };
}

function eventSchema(operation: PublicOperationDefinition): JsonSchema {
  return {
    $id: `https://schemas.zhiju.local/api/1.0/${operation.type}`,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: [
      'eventId',
      'eventType',
      'eventVersion',
      'producerModule',
      'aggregateType',
      'aggregateId',
      'aggregateVersion',
      'scopeRef',
      'correlationId',
      'causationId',
      'commandId',
      'actorRef',
      'occurredAt',
      'dataClassification',
      'payload',
      'integrity',
    ],
    properties: {
      eventId: { $ref: `${common}uuidV7` },
      eventType: { const: operation.type },
      eventVersion: { const: operation.version },
      producerModule: { const: operation.owner },
      aggregateType: { $ref: `${common}namespaceCode` },
      aggregateId: { $ref: `${common}uuidV7` },
      aggregateVersion: { type: 'integer', minimum: 1 },
      scopeRef: { $ref: `${common}scopeRef` },
      correlationId: { $ref: `${common}uuidV7` },
      causationId: { $ref: `${common}uuidV7` },
      commandId: { $ref: `${common}uuidV7` },
      actorRef: { $ref: `${common}typedReference` },
      occurredAt: { $ref: `${common}utcInstant` },
      dataClassification: {
        enum: [
          'PUBLIC_AUTHORITY',
          'INTERNAL',
          'CUSTOMER_CONFIDENTIAL',
          'RESTRICTED_PERSONAL',
          'REGULATED',
        ],
      },
      payload: payloadSchema(operation),
      integrity: { $ref: `${common}integrity` },
    },
  };
}

export function operationEnvelopeSchema(operation: PublicOperationDefinition): JsonSchema {
  switch (operation.kind) {
    case 'COMMAND':
      return commandSchema(operation);
    case 'QUERY':
      return querySchema(operation);
    case 'EVENT':
      return eventSchema(operation);
  }
}
