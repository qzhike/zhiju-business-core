import { describe, expect, it } from 'vitest';
import type { Artifact, Common } from '@zhiju/contracts';
import type { ArtifactTransactionContext } from '../persistence/artifact-db.js';
import {
  canonicalizeStructuredDocument,
  diffStructuredDocuments,
  validateStructuredDocument,
} from './structured-document-service.js';
import {
  ArtifactBusinessError,
  ARTIFACT_QUERY_SCOPE_MISMATCH,
  ARTIFACT_STRUCTURE_SCHEMA_INVALID,
  ARTIFACT_STRUCTURED_DOCUMENT_ID_MISMATCH,
} from './artifact-business-errors.js';

const ENTERPRISE = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const PROJECT = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const OTHER_PROJECT = '018f22e2-7c15-7b2e-8d86-2de956a9d203';
const PRINCIPAL = '018f22e2-7c15-7b2e-8d86-2de956a9d302';
const ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9d303';
const DECISION = '018f22e2-7c15-7b2e-8d86-2de956a9d304';
const POLICY = '018f22e2-7c15-7b2e-8d86-2de956a9d305';
const DOCUMENT_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d221';
const SCHEMA_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const SCHEMA_VERSION_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d211';
const EVIDENCE_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d231';
const EVIDENCE_VERSION_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d232';

function context(): ArtifactTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: PRINCIPAL,
    principalKind: 'HUMAN',
    actorSnapshotId: ACTOR,
    authorizationDecisionId: DECISION,
    authorizationDecisionHash: Buffer.alloc(32, 0x95),
    authorizationDecisionExpiresAt: new Date(Date.now() + 60_000),
    policySnapshotId: POLICY,
    enterpriseId: ENTERPRISE,
    allowedProjectIds: [PROJECT],
    correlationId: '018f22e2-7c15-7b2e-8d86-2de956a9d241',
  };
}

function schemaRef(): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: 'artifact.canonical_document_schema',
    objectId: SCHEMA_ID,
    versionId: SCHEMA_VERSION_ID,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
  };
}

function document(overrides: Partial<Artifact.CanonicalDocument> = {}): Artifact.CanonicalDocument {
  return {
    documentId: DOCUMENT_ID,
    title: 'Synthetic procurement procedure',
    units: [
      {
        unitId: 'root',
        unitType: 'SECTION',
        ordinal: 0,
        childUnitIds: ['alpha', 'beta', 'obsolete'],
      },
      {
        unitId: 'alpha',
        parentUnitId: 'root',
        unitType: 'PARAGRAPH',
        ordinal: 0,
        text: 'Review supplier evidence.',
        childUnitIds: [],
      },
      {
        unitId: 'beta',
        parentUnitId: 'root',
        unitType: 'PARAGRAPH',
        ordinal: 1,
        text: 'Approve only after review.',
        childUnitIds: [],
      },
      {
        unitId: 'obsolete',
        parentUnitId: 'root',
        unitType: 'PARAGRAPH',
        ordinal: 2,
        text: 'Obsolete control.',
        childUnitIds: [],
      },
    ],
    ...overrides,
  };
}

function expectBusinessError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ArtifactBusinessError);
    expect((error as ArtifactBusinessError).code).toBe(code);
  }
}

function unitAt(
  units: readonly Artifact.CanonicalDocumentUnit[],
  index: number,
): Artifact.CanonicalDocumentUnit {
  const unit = units[index];
  if (unit === undefined) throw new Error(`fixture Unit ${index} is missing`);
  return unit;
}

describe('Artifact WI-06 Structured Document service', () => {
  it('normalizes sibling and Unit array order before hashing', () => {
    const canonical = canonicalizeStructuredDocument(document(), schemaRef(), context(), PROJECT);
    const sourceUnits = document().units;
    const shuffled = document({
      units: [
        unitAt(sourceUnits, 3),
        unitAt(sourceUnits, 0),
        unitAt(sourceUnits, 2),
        unitAt(sourceUnits, 1),
      ],
    });
    const shuffledCanonical = canonicalizeStructuredDocument(
      shuffled,
      schemaRef(),
      context(),
      PROJECT,
    );

    expect(shuffledCanonical.canonicalBytes.equals(canonical.canonicalBytes)).toBe(true);
    expect(shuffledCanonical.contentHash).toEqual(canonical.contentHash);
    expect(shuffledCanonical.payload.body.units.map((unit) => unit.unitId)).toEqual([
      'root',
      'alpha',
      'beta',
      'obsolete',
    ]);
    expect(shuffledCanonical.payload.body.units[0]?.childUnitIds).toEqual([
      'alpha',
      'beta',
      'obsolete',
    ]);
  });

  it('validates hierarchy, closed Unit identity and evidence Scope before hashing', () => {
    const invalid = document({
      units: [
        ...document().units,
        {
          unitId: 'alpha',
          unitType: 'PARAGRAPH',
          ordinal: 3,
          childUnitIds: [],
        },
      ],
    });
    expectBusinessError(
      () => canonicalizeStructuredDocument(invalid, schemaRef(), context(), PROJECT),
      ARTIFACT_STRUCTURE_SCHEMA_INVALID,
    );

    const brokenHierarchy = document({
      units: document().units.map((unit) =>
        unit.unitId === 'beta' ? { ...unit, parentUnitId: 'missing-parent' } : unit,
      ),
    });
    expectBusinessError(
      () => canonicalizeStructuredDocument(brokenHierarchy, schemaRef(), context(), PROJECT),
      ARTIFACT_STRUCTURE_SCHEMA_INVALID,
    );

    const crossProjectEvidence = document({
      units: document().units.map((unit) =>
        unit.unitId === 'alpha'
          ? {
              ...unit,
              evidenceRefs: [
                {
                  kind: 'CONTENT_ADDRESSED' as const,
                  objectType: 'evidence.source_material',
                  objectId: EVIDENCE_ID,
                  immutableVersionId: EVIDENCE_VERSION_ID,
                  scope: { enterpriseId: ENTERPRISE, projectId: OTHER_PROJECT },
                  contentHash: {
                    algorithm: 'SHA-256' as const,
                    digest: 'a'.repeat(64),
                    canonicalizationVersion: '1' as const,
                  },
                },
              ],
            }
          : unit,
      ),
    });
    expectBusinessError(
      () =>
        canonicalizeStructuredDocument(
          crossProjectEvidence,
          schemaRef(),
          { ...context(), allowedProjectIds: [PROJECT, OTHER_PROJECT] },
          PROJECT,
        ),
      ARTIFACT_QUERY_SCOPE_MISMATCH,
    );
  });

  it('reports stable Added, Removed, Changed and Moved Unit entries', () => {
    const left = document();
    const right = document({
      units: [
        {
          unitId: 'root',
          unitType: 'SECTION',
          ordinal: 0,
          childUnitIds: ['beta', 'gamma', 'alpha'],
        },
        {
          unitId: 'alpha',
          parentUnitId: 'root',
          unitType: 'PARAGRAPH',
          ordinal: 2,
          text: 'Review supplier evidence and sanctions.',
          childUnitIds: [],
        },
        {
          unitId: 'beta',
          parentUnitId: 'root',
          unitType: 'PARAGRAPH',
          ordinal: 0,
          text: 'Approve only after review.',
          childUnitIds: [],
        },
        {
          unitId: 'gamma',
          parentUnitId: 'root',
          unitType: 'PARAGRAPH',
          ordinal: 1,
          text: 'Record the approval decision.',
          childUnitIds: [],
        },
      ],
    });
    const result = diffStructuredDocuments(left, right);

    expect(result.documentChanged).toBe(false);
    expect(result.entries).toEqual([
      { kind: 'CHANGED', unitId: 'alpha' },
      {
        kind: 'MOVED',
        unitId: 'alpha',
        from: { parentUnitId: 'root', ordinal: 0 },
        to: { parentUnitId: 'root', ordinal: 2 },
      },
      {
        kind: 'MOVED',
        unitId: 'beta',
        from: { parentUnitId: 'root', ordinal: 1 },
        to: { parentUnitId: 'root', ordinal: 0 },
      },
      { kind: 'ADDED', unitId: 'gamma', to: { parentUnitId: 'root', ordinal: 1 } },
      { kind: 'REMOVED', unitId: 'obsolete', from: { parentUnitId: 'root', ordinal: 2 } },
    ]);
    expect(diffStructuredDocuments(left, right)).toEqual(result);
  });

  it('rejects Diff between different Document identities and supports context validation', () => {
    expect(validateStructuredDocument(document(), context(), PROJECT)).toEqual(
      canonicalizeStructuredDocument(document(), schemaRef(), context(), PROJECT).payload.body,
    );
    expectBusinessError(
      () =>
        diffStructuredDocuments(
          document(),
          document({ documentId: '018f22e2-7c15-7b2e-8d86-2de956a9d222' }),
        ),
      ARTIFACT_STRUCTURED_DOCUMENT_ID_MISMATCH,
    );
  });
});
