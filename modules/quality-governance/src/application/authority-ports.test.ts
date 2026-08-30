import { describe, expect, it, vi } from 'vitest';
import type { Common } from '@zhiju/contracts';
import {
  QUALITY_REFERENCE_VALIDATION_FAILED,
  validateQualityAuthorities,
  type QualityAuthorityPorts,
  type QualityAuthorityValidationInput,
} from './authority-ports.js';

const ENTERPRISE = '11111111-1111-7111-8111-111111111111';
const PROJECT = '22222222-2222-7222-8222-222222222222';
const PRINCIPAL = '33333333-3333-7333-8333-333333333333';
const ACTOR = '44444444-4444-7444-8444-444444444444';
const DECISION = '55555555-5555-7555-8555-555555555555';
const OBJECT = '66666666-6666-7666-8666-666666666666';
const REVISION = '77777777-7777-7777-8777-777777777777';
const HASH: Common.ContentHash = {
  algorithm: 'SHA-256',
  digest: 'ab'.repeat(32),
  canonicalizationVersion: '1',
};
const SCOPE: Common.ScopeRef = { enterpriseId: ENTERPRISE, projectId: PROJECT };
const PRINCIPAL_REF: Common.ObjectRef = {
  kind: 'OBJECT',
  objectType: 'identity.principal',
  objectId: PRINCIPAL,
  scope: { enterpriseId: ENTERPRISE },
};
const OBJECT_REF: Common.ObjectRef = {
  kind: 'OBJECT',
  objectType: 'project.project',
  objectId: OBJECT,
  scope: SCOPE,
};
const REVISION_REF: Common.ContentAddressedRef = {
  kind: 'CONTENT_ADDRESSED',
  objectType: 'artifact.artifact_revision',
  objectId: REVISION,
  immutableVersionId: REVISION,
  scope: SCOPE,
  contentHash: HASH,
};

function input(): QualityAuthorityValidationInput {
  return {
    principalRef: PRINCIPAL_REF,
    expectedPrincipalKind: 'HUMAN',
    principalPurpose: 'quality.foundation.verify',
    actorSnapshotRef: {
      kind: 'SNAPSHOT',
      objectType: 'identity.actor_snapshot',
      objectId: ACTOR,
      snapshotId: ACTOR,
      scope: SCOPE,
      contentHash: HASH,
    },
    authorizationIntent: {
      commandType: 'quality.foundation.verify',
      commandVersion: '1.0',
      scopeRef: SCOPE,
      targetRef: OBJECT_REF,
      requestedCapability: 'quality.foundation.verify',
      payloadHash: HASH,
      requestedAt: '2026-08-30T00:00:00.000Z',
      highRiskAction: false,
    },
    authenticationContextRef: REVISION_REF,
    expectedAuthorizationDecisionId: DECISION,
    objectRef: OBJECT_REF,
    revisionRef: REVISION_REF,
    expectedScopeRef: SCOPE,
    referencePurpose: 'quality.foundation.verify',
    allowedRevisionDispositions: ['ACTIVE'],
    asOf: new Date('2026-08-30T00:00:00.000Z'),
  };
}

function ports(): QualityAuthorityPorts {
  return {
    identityPolicy: {
      resolvePrincipal: vi.fn().mockResolvedValue({
        principalRef: PRINCIPAL_REF,
        principalKind: 'HUMAN',
        status: 'ACTIVE',
        displayName: { presence: 'REDACTED', evidenceRefs: [] },
      }),
      authorizeCommand: vi.fn().mockResolvedValue({
        authorizationDecisionRef: {
          ...REVISION_REF,
          objectType: 'identity.authorization_decision',
          objectId: DECISION,
          immutableVersionId: DECISION,
        },
        outcome: 'ALLOW',
        reasons: [],
        policySnapshotRef: {
          kind: 'SNAPSHOT',
          objectType: 'identity.policy_snapshot',
          objectId: ACTOR,
          snapshotId: ACTOR,
          scope: SCOPE,
          contentHash: HASH,
        },
        effectiveScopeRef: SCOPE,
        expiresAt: '2026-08-30T01:00:00.000Z',
      }),
    },
    enterpriseProject: {
      validateObjectScope: vi.fn().mockResolvedValue({
        valid: true,
        authoritativeScopeRef: SCOPE,
        resolvedRef: OBJECT_REF,
        lifecycle: 'ACTIVE',
        reasons: [],
      }),
    },
    artifact: {
      validateRevisionRef: vi.fn().mockResolvedValue({
        valid: true,
        exactRef: REVISION_REF,
        authoritativeScopeRef: SCOPE,
        disposition: 'ACTIVE',
        contentAvailable: true,
        reasons: [],
      }),
    },
  };
}

describe('QualityGovernance public authority ports', () => {
  it('calls only the exact public operations and accepts exact authority facts', async () => {
    const adapters = ports();
    const result = await validateQualityAuthorities(adapters, input());
    expect(result.revision.exactRef).toEqual(REVISION_REF);
    expect(adapters.identityPolicy.resolvePrincipal).toHaveBeenCalledWith(
      'identity.resolve_principal',
      expect.any(Object),
    );
    expect(adapters.identityPolicy.authorizeCommand).toHaveBeenCalledWith(
      'identity.authorize_command',
      expect.any(Object),
    );
    expect(adapters.enterpriseProject.validateObjectScope).toHaveBeenCalledWith(
      'project.validate_object_scope',
      expect.any(Object),
    );
    expect(adapters.artifact.validateRevisionRef).toHaveBeenCalledWith(
      'artifact.validate_revision_ref',
      expect.any(Object),
    );
  });

  it('fails closed when an authority substitutes a different exact reference', async () => {
    const baseline = ports();
    const adapters: QualityAuthorityPorts = {
      ...baseline,
      artifact: {
        validateRevisionRef: vi.fn().mockResolvedValue({
          valid: true,
          exactRef: { ...REVISION_REF, contentHash: { ...HASH, digest: 'cd'.repeat(32) } },
          authoritativeScopeRef: SCOPE,
          disposition: 'ACTIVE',
          contentAvailable: true,
          reasons: [],
        }),
      },
    };
    await expect(validateQualityAuthorities(adapters, input())).rejects.toMatchObject({
      code: QUALITY_REFERENCE_VALIDATION_FAILED,
    });
  });

  it('fails closed for expired authorization or cross-project scope', async () => {
    const expiredBaseline = ports();
    const expired: QualityAuthorityPorts = {
      ...expiredBaseline,
      identityPolicy: {
        ...expiredBaseline.identityPolicy,
        authorizeCommand: vi.fn().mockResolvedValue({
          authorizationDecisionRef: { ...REVISION_REF, objectId: DECISION },
          outcome: 'ALLOW',
          reasons: [],
          policySnapshotRef: input().actorSnapshotRef,
          effectiveScopeRef: SCOPE,
          expiresAt: '2026-08-29T23:59:59.000Z',
        }),
      },
    };
    await expect(validateQualityAuthorities(expired, input())).rejects.toMatchObject({
      code: QUALITY_REFERENCE_VALIDATION_FAILED,
    });

    const scopeBaseline = ports();
    const wrongScope: QualityAuthorityPorts = {
      ...scopeBaseline,
      enterpriseProject: {
        validateObjectScope: vi.fn().mockResolvedValue({
          valid: true,
          authoritativeScopeRef: {
            enterpriseId: ENTERPRISE,
            projectId: '88888888-8888-7888-8888-888888888888',
          },
          resolvedRef: OBJECT_REF,
          reasons: [],
        }),
      },
    };
    await expect(validateQualityAuthorities(wrongScope, input())).rejects.toMatchObject({
      code: QUALITY_REFERENCE_VALIDATION_FAILED,
    });
  });
});
