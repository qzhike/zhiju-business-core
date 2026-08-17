import type { AnySchemaObject } from 'ajv';

export type JsonSchema = AnySchemaObject;

export interface PublicOperationDefinition {
  readonly type: string;
  readonly version: '1.0';
  readonly kind: 'COMMAND' | 'QUERY' | 'EVENT';
  readonly owner: string;
  readonly schemaStatus: 'ENVELOPE_ONLY' | 'FULL';
}
