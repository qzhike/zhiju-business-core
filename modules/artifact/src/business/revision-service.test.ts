import { describe, expect, it } from 'vitest';
import type { Artifact } from '@zhiju/contracts';
import type { ArtifactTransactionContext } from '../persistence/artifact-db.js';
import {
  validateArtifactMergeDefinition,
  validateArtifactRevisionContent,
} from './revision-service.js';
import {
  ArtifactBusinessError,
  ARTIFACT_MERGE_CONFLICT_UNRESOLVED,
  ARTIFACT_PARENT_REQUIRED,
  ARTIFACT_SCOPE_INVALID,
} from './artifact-business-errors.js';

const ENTERPRISE = 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a1a1';
const PROJECT = 'b2b2b2b2-b2b2-72b2-82b2-b2b2b2b2b2b2';
const ARTIFACT = 'c3c3c3c3-c3c3-73c3-83c3-c3c3c3c3c3c3';
const BRANCH = 'd4d4d4d4-d4d4-74d4-84d4-d4d4d4d4d4d4';
const PRINCIPAL = 'e5e5e5e5-e5e5-75e5-85e5-e5e5e5e5e5e5';
const ACTOR = 'f6f6f6f6-f6f6-76f6-86f6-f6f6f6f6f6f6';
const DECISION = '07070707-0707-7707-8707-070707070707';
const POLICY = '08080808-0808-7808-8808-080808080808';
const CORRELATION = '09090909-0909-7909-8909-090909090909';
const SCHEMA = '10101010-1010-7010-8010-101010101010';
const SCHEMA_VERSION = '11111111-1111-7111-8111-111111111111';
const PARENT = '12121212-1212-7212-8212-121212121212';
const PARENT_HASH = 'b'.repeat(64);
const CONTENT_HASH = 'a'.repeat(64);

function context(): ArtifactTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: PRINCIPAL,
    principalKind: 'HUMAN',
    actorSnapshotId: ACTOR,
    authorizationDecisionId: DECISION,
    authorizationDecisionHash: Buffer.alloc(32, 0x11),
    authorizationDecisionExpiresAt: new Date(Date.now() + 60_000),
    policySnapshotId: POLICY,
    enterpriseId: ENTERPRISE,
    allowedProjectIds: [PROJECT],
    correlationId: CORRELATION,
  };
}

function artifactRef() {
  return {
    kind: 'OBJECT' as const,
    objectType: 'Artifact',
    objectId: ARTIFACT,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
  };
}

function revisionRef(revisionId = PARENT, digest = PARENT_HASH) {
  return {
    kind: 'CONTENT_ADDRESSED' as const,
    objectType: 'ArtifactRevision',
    objectId: revisionId,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
    contentHash: {
      algorithm: 'SHA-256' as const,
      digest,
      canonicalizationVersion: '1' as const,
    },
  };
}

function schemaRef() {
  return {
    kind: 'VERSIONED' as const,
    objectType: 'artifact.structure_schema',
    objectId: SCHEMA,
    versionId: SCHEMA_VERSION,
    scope: { enterpriseId: ENTERPRISE },
  };
}

function provenance(): Artifact.RevisionProvenance {
  return {
    principal: {
      kind: 'OBJECT',
      objectType: 'identity.principal',
      objectId: PRINCIPAL,
      scope: { enterpriseId: ENTERPRISE },
    },
    sourceMaterialRefs: [],
    toolchainVersions: [],
  };
}

function revision(overrides: Record<string, unknown> = {}) {
  return {
    artifactRef: artifactRef(),
    branchId: BRANCH,
    parentRevisionRefs: [],
    contentType: 'STRUCTURED_DOCUMENT',
    contentRef: 'staging/canonical/content-001',
    contentHash: {
      algorithm: 'SHA-256',
      digest: CONTENT_HASH,
      canonicalizationVersion: '1',
    },
    structureSchemaRef: schemaRef(),
    semanticMetadata: { source: 'unit-test' },
    changedUnits: ['unit-001'],
    changeSummary: 'initial revision',
    provenance: provenance(),
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

describe('Artifact WI-05 revision validation', () => {
  it('accepts an initial revision and an Enterprise-scoped schema for a Project Artifact', () => {
    const validated = validateArtifactRevisionContent(revision(), context(), PROJECT);

    expect(validated.artifactId).toBe(ARTIFACT);
    expect(validated.parentRefs).toHaveLength(0);
    expect(validated.structureSchemaRef.scope).toEqual({ enterpriseId: ENTERPRISE });
  });

  it('enforces initial/ordinary parent cardinality and exact parent identity', () => {
    expectBusinessError(
      () =>
        validateArtifactRevisionContent(
          revision({
            parentRevisionRefs: [
              revisionRef(),
              revisionRef('13131313-1313-7313-8313-131313131313'),
            ],
          }),
          context(),
          PROJECT,
        ),
      ARTIFACT_PARENT_REQUIRED,
    );
    expectBusinessError(
      () =>
        validateArtifactRevisionContent(
          revision({ parentRevisionRefs: [revisionRef(), revisionRef()] }),
          context(),
          PROJECT,
        ),
      ARTIFACT_PARENT_REQUIRED,
    );
    expectBusinessError(
      () =>
        validateArtifactRevisionContent(
          revision({ parentRevisionRefs: [{ ...revisionRef(), objectId: 'latest' }] }),
          context(),
          PROJECT,
        ),
      ARTIFACT_SCOPE_INVALID,
    );
  });

  it('requires explicit Merge resolution and a Human resolvedBy', () => {
    const firstParent = revisionRef();
    const secondParent = revisionRef('13131313-1313-7313-8313-131313131313', 'c'.repeat(64));
    expectBusinessError(
      () =>
        validateArtifactMergeDefinition(
          {
            revision: revision({ parentRevisionRefs: [firstParent] }),
            mergeStrategy: 'MANUAL_RESOLUTION',
            conflictSet: [],
            conflictResolutionRefs: [],
            resolvedBy: {
              kind: 'OBJECT',
              objectType: 'identity.principal',
              objectId: PRINCIPAL,
              scope: { enterpriseId: ENTERPRISE },
            },
          },
          context(),
          PROJECT,
        ),
      ARTIFACT_PARENT_REQUIRED,
    );
    const merge = {
      revision: revision({ parentRevisionRefs: [firstParent, secondParent] }),
      mergeStrategy: 'MANUAL_RESOLUTION',
      conflictSet: [{ unitId: 'unit-001', reason: 'changed-both-sides' }],
      conflictResolutionRefs: [],
      resolvedBy: {
        kind: 'OBJECT',
        objectType: 'identity.principal',
        objectId: PRINCIPAL,
        scope: { enterpriseId: ENTERPRISE },
      },
    };

    expectBusinessError(
      () => validateArtifactMergeDefinition(merge, context(), PROJECT),
      ARTIFACT_MERGE_CONFLICT_UNRESOLVED,
    );
  });
});
