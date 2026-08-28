import { describe, expect, it } from 'vitest';
import type { Artifact } from '@zhiju/contracts';
import {
  applyArtifactMetadataPatch,
  validateArtifactCreatePayload,
  validateArtifactMetadataUpdatePayload,
  type CreateArtifactPayload,
} from './artifact-handlers.js';
import {
  ArtifactBusinessError,
  ARTIFACT_METADATA_FIELD_FORBIDDEN,
  ARTIFACT_SCOPE_INVALID,
} from './artifact-business-errors.js';
import type { ArtifactTransactionContext } from '../persistence/artifact-db.js';

const ENTERPRISE = 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a1a1';
const PROJECT_A = 'b2b2b2b2-b2b2-72b2-82b2-b2b2b2b2b2b2';
const PROJECT_B = 'c3c3c3c3-c3c3-73c3-83c3-c3c3c3c3c3c3';
const PRINCIPAL = 'd4d4d4d4-d4d4-74d4-84d4-d4d4d4d4d4d4';
const ACTOR = 'e5e5e5e5-e5e5-75e5-85e5-e5e5e5e5e5e5';
const DECISION = 'f6f6f6f6-f6f6-76f6-86f6-f6f6f6f6f6f6';
const POLICY = '07070707-0707-7707-8707-070707070707';
const CORRELATION = '08080808-0808-7808-8808-080808080808';
const DELIVERY_ITEM = '09090909-0909-7909-8909-090909090909';
const DELIVERY_VERSION = '10101010-1010-7010-8010-101010101010';

function context(allowedProjectIds: readonly string[] = [PROJECT_A]): ArtifactTransactionContext {
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
    allowedProjectIds,
    correlationId: CORRELATION,
  };
}

function projectRef(projectId: string) {
  return {
    kind: 'OBJECT' as const,
    objectType: 'Project',
    objectId: projectId,
    scope: { enterpriseId: ENTERPRISE, projectId },
  };
}

function deliveryRef(projectId: string) {
  return {
    kind: 'VERSIONED' as const,
    objectType: 'DeliveryItem',
    objectId: DELIVERY_ITEM,
    versionId: DELIVERY_VERSION,
    scope: { enterpriseId: ENTERPRISE, projectId },
  };
}

function payload(overrides: Partial<Artifact.ArtifactDefinition> = {}): CreateArtifactPayload {
  return {
    enterpriseRef: {
      kind: 'OBJECT',
      objectType: 'Enterprise',
      objectId: ENTERPRISE,
      scope: { enterpriseId: ENTERPRISE },
    },
    definition: {
      businessScope: 'PROJECT_DELIVERABLE',
      originProjectRef: projectRef(PROJECT_A),
      artifactType: 'CONTROL_PROCEDURE',
      title: 'ART-023',
      classification: 'CUSTOMER_DELIVERY',
      deliveryItemRefs: [deliveryRef(PROJECT_A)],
      metadata: { source: 'fixture', nested: { retained: true } },
      ...overrides,
    },
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

describe('Artifact WI-03 pure business validation', () => {
  it('validates an exact Project Deliverable scope and derives a stable identity digest', () => {
    const validated = validateArtifactCreatePayload(payload(), context());

    expect(validated.projectId).toBe(PROJECT_A);
    expect(validated.originProjectRef).toEqual(projectRef(PROJECT_A));
    expect(validated.identityHash).toHaveLength(32);
    expect(validated.definition).toMatchObject({
      businessScope: 'PROJECT_DELIVERABLE',
      artifactType: 'CONTROL_PROCEDURE',
      title: 'ART-023',
    });
  });

  it('rejects missing origin Project and cross-Project DeliveryItem references', () => {
    expectBusinessError(() => {
      const missingOriginPayload = payload();
      const missingOriginDefinition = { ...missingOriginPayload.definition };
      delete missingOriginDefinition.originProjectRef;
      validateArtifactCreatePayload(
        { ...missingOriginPayload, definition: missingOriginDefinition },
        context(),
      );
    }, ARTIFACT_SCOPE_INVALID);
    expectBusinessError(
      () =>
        validateArtifactCreatePayload(
          payload({ deliveryItemRefs: [deliveryRef(PROJECT_B)] }),
          context([PROJECT_A, PROJECT_B]),
        ),
      ARTIFACT_SCOPE_INVALID,
    );
  });

  it('rejects protected metadata fields and applies nested JSON Merge Patch', () => {
    expectBusinessError(
      () =>
        validateArtifactMetadataUpdatePayload({
          metadataPatch: { businessScope: 'ENTERPRISE_CONTROLLED' },
          changeReason: { reasonCode: 'CHANGE', summary: 'update', evidenceRefs: [] },
        }),
      ARTIFACT_METADATA_FIELD_FORBIDDEN,
    );

    const updated = applyArtifactMetadataPatch(
      {
        keep: 'yes',
        nested: { keep: 'yes', remove: true },
      },
      { nested: { keep: 'no', remove: null }, add: 1 },
    );
    expect(updated).toEqual({ keep: 'yes', nested: { keep: 'no' }, add: 1 });
    expect(applyArtifactMetadataPatch({ old: true }, null)).toBeNull();
  });
});
