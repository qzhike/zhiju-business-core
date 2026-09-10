import type { AnySchemaObject } from 'ajv';

export type JsonSchema = AnySchemaObject;

export interface PayloadGuardPolicyRef {
  readonly type: string;
  readonly version: string;
}

export interface OperationReferenceDeclaration {
  readonly path: string;
  readonly kind: 'OBJECT' | 'VERSIONED' | 'CONTENT_ADDRESSED' | 'SNAPSHOT' | 'PRINCIPAL';
  readonly objectType: string;
}

export interface PublicOperationDefinition {
  readonly type: string;
  readonly version: '1.0';
  readonly kind: 'COMMAND' | 'QUERY' | 'EVENT';
  readonly owner: string;
  readonly schemaStatus: 'ENVELOPE_ONLY' | 'FULL';
  readonly targetObjectType?: string;
  readonly concurrencyMode?: 'CREATE';
  readonly allowedConsistency?: readonly (
    'AUTHORITATIVE' | 'SNAPSHOT_AT_LEAST' | 'PROJECTION_OK'
  )[];
  readonly authorizationPurpose?: string;
  readonly dataClassification?: string;
  readonly payloadGuardPolicyRef?: PayloadGuardPolicyRef;
  readonly references?: readonly OperationReferenceDeclaration[];
  readonly resultReferences?: readonly OperationReferenceDeclaration[];
}

function operationDefinitionName(type: string, suffix: 'payload' | 'result'): string {
  return `${type.replaceAll('.', '_')}_${suffix}`;
}

export function operationPayloadSchemaRef(
  operation: PublicOperationDefinition,
): string | undefined {
  if (operation.schemaStatus !== 'FULL') return undefined;
  return `https://schemas.zhiju.local/modules/${operation.owner}/1.0#/$defs/${operationDefinitionName(operation.type, 'payload')}`;
}

export function operationResultSchemaRef(operation: PublicOperationDefinition): string | undefined {
  if (operation.schemaStatus !== 'FULL' || operation.kind !== 'QUERY') return undefined;
  return `https://schemas.zhiju.local/modules/${operation.owner}/1.0#/$defs/${operationDefinitionName(operation.type, 'result')}`;
}
