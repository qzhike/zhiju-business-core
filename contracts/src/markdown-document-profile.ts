// #270 Markdown document profile: the checked-in registry
// (contracts/registry/artifact-markdown-schemas.v1.json) is the single source of
// truth for the `artifact.markdown_document@1.0` profile, its
// `artifact.markdown_document.schema@1.0` selector and the closed
// `artifact.markdown_limits@1.0` budgets. The generated copy is a byte-for-byte
// mirror and this loader rejects any unapproved value before it is consumed.

import { isDeepStrictEqual } from 'node:util';

import type { Common } from './generated/types/common.js';
import schema from './generated/artifact-markdown-schemas.json' with { type: 'json' };

const approved = {
  profileKey: 'artifact.markdown_document@1.0',
  registryKey: 'artifact.markdown_document.schema@1.0',
  owner: 'artifact',
  objectType: 'artifact.canonical_document_schema',
  objectId: '0199b600-0000-7000-8000-000000000402',
  versionId: '0199b600-0000-7000-8000-000000000412',
  schemaId: 'https://schemas.zhiju.local/modules/artifact/1.0#/$defs/markdownDocumentContent',
  limitsProfileKey: 'artifact.markdown_limits@1.0',
  limits: {
    maxFileBytes: 10_485_760,
    maxUnits: 100_000,
    maxBlockDepth: 6,
    maxTableColumns: 128,
    maxTableRows: 10_000,
    maxLogicalTextCodePoints: 65_536,
    maxParseMilliseconds: 10_000,
    maxParseHeapBytes: 268_435_456,
  },
} as const;

export type MarkdownLimits = (typeof approved)['limits'];

export interface ArtifactMarkdownSchema {
  readonly profileKey: string;
  readonly registryKey: string;
  readonly owner: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly versionId: string;
  readonly schemaId: string;
  readonly limitsProfileKey: string;
  readonly limits: MarkdownLimits;
}

export function loadArtifactMarkdownSchema(input: unknown): ArtifactMarkdownSchema {
  if (!isDeepStrictEqual(input, approved)) throw new Error('Unapproved markdown document schema');
  return Object.freeze(structuredClone(approved));
}

export const artifactMarkdownSchema = loadArtifactMarkdownSchema(schema);

/** Closed `artifact.markdown_limits@1.0` budgets enforced by the parser. */
export const markdownDocumentLimits: MarkdownLimits = artifactMarkdownSchema.limits;

export function markdownDocumentSchemaReference(enterpriseId: string): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: artifactMarkdownSchema.objectType,
    objectId: artifactMarkdownSchema.objectId,
    versionId: artifactMarkdownSchema.versionId,
    scope: { enterpriseId },
  };
}

export function isMarkdownDocumentSchema(value: unknown, enterpriseId: string): boolean {
  return isDeepStrictEqual(value, markdownDocumentSchemaReference(enterpriseId));
}
