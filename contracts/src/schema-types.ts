import type { AnySchemaObject } from 'ajv';

export type JsonSchema = AnySchemaObject;

export type OperationVersion = '1.0' | '1.1' | '2.0';

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
  readonly version: OperationVersion;
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
  /**
   * Explicit result schema for a COMMAND that returns operation-specific
   * CommandResult data. Commands without one keep `data` out of the public
   * contract; QUERY result schemas stay derived from the operation identity.
   */
  readonly resultSchemaRef?: string;
}

export function operationSchemaDefinitionName(
  type: string,
  version: OperationVersion,
  suffix: 'payload' | 'result',
): string {
  const versionSuffix = version === '1.0' ? '' : `_v${version.replaceAll('.', '_')}`;
  return `${type.replaceAll('.', '_')}${versionSuffix}_${suffix}`;
}

export function operationEnvelopeSchemaId(operation: PublicOperationDefinition): string {
  return `https://schemas.zhiju.local/api/${operation.version}/${operation.type}`;
}

export function operationPayloadSchemaRef(
  operation: PublicOperationDefinition,
): string | undefined {
  if (operation.schemaStatus !== 'FULL') return undefined;
  return `https://schemas.zhiju.local/modules/${operation.owner}/1.0#/$defs/${operationSchemaDefinitionName(operation.type, operation.version, 'payload')}`;
}

export function operationResultSchemaRef(operation: PublicOperationDefinition): string | undefined {
  if (operation.schemaStatus !== 'FULL') return undefined;
  if (operation.kind === 'QUERY') {
    return `https://schemas.zhiju.local/modules/${operation.owner}/1.0#/$defs/${operationSchemaDefinitionName(operation.type, operation.version, 'result')}`;
  }
  return operation.resultSchemaRef;
}
