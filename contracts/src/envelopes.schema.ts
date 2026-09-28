import type { JsonSchema, OperationVersion, PublicOperationDefinition } from './schema-types.js';

const common = 'https://schemas.zhiju.local/common/1.0#/$defs/';

function operationSchemaDefinitionName(
  type: string,
  version: OperationVersion,
  suffix: 'payload' | 'result',
): string {
  const versionSuffix = version === '1.0' ? '' : `_v${version.replaceAll('.', '_')}`;
  return `${type.replaceAll('.', '_')}${versionSuffix}_${suffix}`;
}

function operationEnvelopeSchemaId(operation: PublicOperationDefinition): string {
  return `https://schemas.zhiju.local/api/${operation.version}/${operation.type}`;
}

function operationPayloadSchemaRef(operation: PublicOperationDefinition): string | undefined {
  if (operation.schemaStatus !== 'FULL') return undefined;
  return `https://schemas.zhiju.local/modules/${operation.owner}/1.0#/$defs/${operationSchemaDefinitionName(operation.type, operation.version, 'payload')}`;
}

function payloadSchema(operation: PublicOperationDefinition): JsonSchema {
  const schemaRef = operationPayloadSchemaRef(operation);
  return schemaRef === undefined ? { type: 'object' } : { $ref: schemaRef };
}

function operationScopeSchema(operation: PublicOperationDefinition): JsonSchema {
  const projectRequired =
    (operation.type === 'execution.build_context_snapshot' && operation.version === '1.1') ||
    [
      'execution.reconcile_task_execution',
      'execution.get_task_state',
      'execution.get_work_order_execution_state',
    ].includes(operation.type);
  return projectRequired
    ? {
        allOf: [
          { $ref: `${common}scopeRef` },
          {
            type: 'object',
            required: ['enterpriseId', 'projectId'],
            properties: {
              enterpriseId: { $ref: `${common}uuidV7` },
              projectId: { $ref: `${common}uuidV7` },
            },
          },
        ],
      }
    : { $ref: `${common}scopeRef` };
}

function commandSchema(operation: PublicOperationDefinition): JsonSchema {
  return {
    $id: operationEnvelopeSchemaId(operation),
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
      ...(operation.concurrencyMode === 'MUTATE' ? ['expectedAggregateVersion'] : []),
    ],
    properties: {
      commandId: { $ref: `${common}uuidV7` },
      commandType: { const: operation.type },
      commandVersion: { const: operation.version },
      scopeRef: operationScopeSchema(operation),
      targetRef:
        operation.targetObjectType === undefined
          ? { $ref: `${common}objectRef` }
          : {
              allOf: [
                { $ref: `${common}objectRef` },
                {
                  type: 'object',
                  properties: { objectType: { const: operation.targetObjectType } },
                },
              ],
            },
      expectedAggregateVersion:
        operation.concurrencyMode === 'CREATE' ? false : { type: 'integer', minimum: 0 },
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
    $id: operationEnvelopeSchemaId(operation),
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
      scopeRef: operationScopeSchema(operation),
      requester: { $ref: `${common}typedReference` },
      authenticationContextRef: { $ref: `${common}typedReference` },
      authorizationDecisionRef: { $ref: `${common}typedReference` },
      consistencyRequirement: {
        enum: operation.allowedConsistency ?? [
          'AUTHORITATIVE',
          'SNAPSHOT_AT_LEAST',
          'PROJECTION_OK',
        ],
      },
      minimumWatermark: { type: 'integer', minimum: 0 },
      asOf: { $ref: `${common}utcInstant` },
      pagination:
        operation.type === 'project.get_context_source_slice' ||
        operation.type === 'execution.get_work_order_draft'
          ? { $ref: `${common}pageRequest` }
          : { type: 'object' },
      correlationId: { $ref: `${common}uuidV7` },
      requestedAt: { $ref: `${common}utcInstant` },
      payload: payloadSchema(operation),
    },
  };
}

function eventSchema(operation: PublicOperationDefinition): JsonSchema {
  return {
    $id: operationEnvelopeSchemaId(operation),
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
      return guardedEnvelope(operation, commandSchema(operation));
    case 'QUERY':
      return guardedEnvelope(operation, querySchema(operation));
    case 'EVENT':
      return eventSchema(operation);
  }
}

function guardedEnvelope(operation: PublicOperationDefinition, schema: JsonSchema): JsonSchema {
  return operation.payloadGuardPolicyRef === undefined
    ? schema
    : { ...schema, payloadGuard: operation.payloadGuardPolicyRef };
}
