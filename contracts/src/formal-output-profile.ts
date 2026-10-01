import { isDeepStrictEqual } from 'node:util';
import type { Common } from './generated/types/common.js';
import schema from './generated/artifact-execution-schemas.json' with { type: 'json' };

const approved = {
  registryKey: 'artifact.execution_document.schema@1.0',
  owner: 'artifact',
  objectType: 'artifact.canonical_document_schema',
  objectId: '0199b600-0000-7000-8000-000000000401',
  versionId: '0199b600-0000-7000-8000-000000000411',
  schemaId: 'https://schemas.zhiju.local/modules/artifact/1.0#/$defs/canonicalDocumentContent',
};
export function loadArtifactExecutionSchema(input: unknown) {
  if (!isDeepStrictEqual(input, approved)) throw new Error('Unapproved execution document schema');
  return Object.freeze(structuredClone(approved));
}
export const artifactExecutionSchema = loadArtifactExecutionSchema(schema);
export function executionDocumentSchemaReference(enterpriseId: string): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: schema.objectType,
    objectId: schema.objectId,
    versionId: schema.versionId,
    scope: { enterpriseId },
  };
}
export function isExecutionDocumentSchema(value: unknown, enterpriseId: string): boolean {
  return isDeepStrictEqual(value, executionDocumentSchemaReference(enterpriseId));
}
