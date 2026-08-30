import { describe, expect, it, vi } from 'vitest';
import type {
  Artifact,
  Common,
  Core,
  QualityGovernance,
  ReleasePublication,
} from '@zhiju/contracts';
import type { ReleaseTransactionContext } from './persistence/release-publication-db.js';
import {
  RELEASE_APPROVAL_BUNDLE_INVALID,
  RELEASE_REVISION_NOT_APPROVED,
  validateDraftAuthorities,
  validateDraftDefinition,
  validateReleasePackageRef,
} from './release-publication-validation.js';

const ENTERPRISE = '018f22e2-7c15-7b2e-8d86-2de956a9d301';
const PROJECT = '018f22e2-7c15-7b2e-8d86-2de956a9d302';
const ARTIFACT = '018f22e2-7c15-7b2e-8d86-2de956a9d303';
const REVISION = '018f22e2-7c15-7b2e-8d86-2de956a9d304';
const PROFILE = '018f22e2-7c15-7b2e-8d86-2de956a9d305';
const PROFILE_VERSION = '018f22e2-7c15-7b2e-8d86-2de956a9d306';
const RAS = '018f22e2-7c15-7b2e-8d86-2de956a9d307';
const ABS = '018f22e2-7c15-7b2e-8d86-2de956a9d308';
const PACKAGE = '018f22e2-7c15-7b2e-8d86-2de956a9d309';
const PRINCIPAL = '018f22e2-7c15-7b2e-8d86-2de956a9d30a';
const ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9d30b';
const DECISION = '018f22e2-7c15-7b2e-8d86-2de956a9d30c';
const POLICY = '018f22e2-7c15-7b2e-8d86-2de956a9d30d';
const CORRELATION = '018f22e2-7c15-7b2e-8d86-2de956a9d30e';

function context(): ReleaseTransactionContext {
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

function hash(byte: number): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: Buffer.alloc(32, byte).toString('hex'),
    canonicalizationVersion: '1',
  };
}

function objectRef(objectType: string, objectId: string): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType,
    objectId,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
  };
}

function revisionRef(): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'artifact.artifact_revision',
    objectId: REVISION,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
    contentHash: hash(0x21),
  };
}

function snapshotRef(objectType: string, objectId: string, byte: number): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId,
    snapshotId: objectId,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
    contentHash: hash(byte),
  };
}

function profileRef(): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: 'quality.quality_profile',
    objectId: PROFILE,
    versionId: PROFILE_VERSION,
    scope: { enterpriseId: ENTERPRISE },
  };
}

function definition(): ReleasePublication.ReleaseDraftDefinition {
  return {
    artifactRef: objectRef('artifact.artifact', ARTIFACT),
    revisionRef: revisionRef(),
    releaseNumber: 'REL-801',
    purpose: 'CUSTOMER_DELIVERY',
    requestedEffectiveAt: '2026-09-01T00:00:00Z',
    qualityProfileRef: profileRef(),
    revisionAcceptanceSnapshotRef: snapshotRef('quality.revision_acceptance_snapshot', RAS, 0x31),
    approvalBundleSnapshotRef: snapshotRef('quality.approval_bundle_snapshot', ABS, 0x32),
  };
}

function authorityPorts() {
  const draft = definition();
  const representationRef: Artifact.RepresentationRef = {
    representationId: PACKAGE,
    revision: draft.revisionRef,
    format: 'PDF',
    mediaType: 'application/pdf',
    objectStorageRef: 'objects/representation',
    checksum: hash(0x41),
    renderer: { rendererId: 'renderer.test', rendererVersion: '1.0.0' },
    createdAt: '2026-08-31T00:00:00Z',
  };
  const revisionValidation: Artifact.ArtifactValidateRevisionRefResult = {
    valid: true,
    exactRef: draft.revisionRef,
    authoritativeScopeRef: draft.revisionRef.scope,
    disposition: 'ACTIVE',
    contentAvailable: true,
    reasons: [],
  };
  const acceptance = {
    header: { scopeRef: draft.revisionAcceptanceSnapshotRef.scope },
    snapshotId: RAS,
    artifactRef: draft.artifactRef,
    revisionRef: draft.revisionRef,
    qualityProfileRef: draft.qualityProfileRef,
    evaluationStage: 'REVISION_ACCEPTANCE',
    readiness: { status: 'READY' },
  } as unknown as Core.RevisionAcceptanceSnapshot;
  const approval = {
    header: { scopeRef: draft.approvalBundleSnapshotRef.scope },
    snapshotId: ABS,
    artifactRef: draft.artifactRef,
    revisionRef: draft.revisionRef,
    revisionAcceptanceSnapshotRef: draft.revisionAcceptanceSnapshotRef,
    qualityProfileRef: draft.qualityProfileRef,
    completeness: { status: 'FULLY_APPROVED' },
    separationOfDutiesResult: { outcome: 'SATISFIED' },
  } as unknown as Core.ApprovalBundleSnapshot;
  const validateRevisionRef = vi.fn(
    (
      _input: Artifact.ArtifactValidateRevisionRefPayload,
    ): Promise<Artifact.ArtifactValidateRevisionRefResult> => {
      void _input;
      return Promise.resolve(revisionValidation);
    },
  );
  const getRepresentation = vi.fn(
    (
      _input: Artifact.ArtifactGetRepresentationPayload,
    ): Promise<Artifact.ArtifactGetRepresentationResult> => {
      void _input;
      return Promise.resolve({
        representationRef,
        status: 'registered',
        registrationRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'artifact.representation_registration',
          objectId: PACKAGE,
          scope: draft.revisionRef.scope,
          contentHash: hash(0x42),
        },
      });
    },
  );
  const getRevisionAcceptanceSnapshot = vi.fn(
    (
      _input: QualityGovernance.QualityGetRevisionAcceptanceSnapshotPayload,
    ): Promise<QualityGovernance.QualityGetRevisionAcceptanceSnapshotResult> => {
      void _input;
      return Promise.resolve(acceptance);
    },
  );
  const getApprovalBundleSnapshot = vi.fn(
    (
      _input: QualityGovernance.QualityGetApprovalBundleSnapshotPayload,
    ): Promise<QualityGovernance.QualityGetApprovalBundleSnapshotResult> => {
      void _input;
      return Promise.resolve(approval);
    },
  );
  return {
    artifact: {
      validateRevisionRef,
      getRepresentation,
    },
    quality: {
      getRevisionAcceptanceSnapshot,
      getApprovalBundleSnapshot,
    },
  };
}

describe('ReleasePublication WI-06 authority validation', () => {
  it('preserves exact public references and infers the Project scope', () => {
    const validated = validateDraftDefinition(definition(), context());
    expect(validated.projectId).toBe(PROJECT);
    expect(validated.definition.revisionRef).toEqual(definition().revisionRef);
  });

  it('requires exact ACTIVE Revision, READY acceptance and FULLY_APPROVED bundle', async () => {
    const ports = authorityPorts();
    await expect(
      validateDraftAuthorities(definition(), context(), ports, PROJECT),
    ).resolves.toBeUndefined();

    ports.artifact.validateRevisionRef.mockResolvedValueOnce({
      valid: true,
      exactRef: definition().revisionRef,
      authoritativeScopeRef: definition().revisionRef.scope,
      disposition: 'WITHDRAWN',
      contentAvailable: true,
      reasons: ['REVISION_WITHDRAWN'],
    });
    await expect(
      validateDraftAuthorities(definition(), context(), ports, PROJECT),
    ).rejects.toMatchObject({ code: RELEASE_REVISION_NOT_APPROVED });

    ports.artifact.validateRevisionRef.mockResolvedValue({
      valid: true,
      exactRef: definition().revisionRef,
      authoritativeScopeRef: definition().revisionRef.scope,
      disposition: 'ACTIVE',
      contentAvailable: true,
      reasons: [],
    });
    ports.quality.getApprovalBundleSnapshot.mockResolvedValueOnce({
      header: { scopeRef: definition().approvalBundleSnapshotRef.scope },
      snapshotId: ABS,
      artifactRef: definition().artifactRef,
      revisionRef: definition().revisionRef,
      revisionAcceptanceSnapshotRef: definition().revisionAcceptanceSnapshotRef,
      qualityProfileRef: definition().qualityProfileRef,
      completeness: { status: 'PARTIALLY_APPROVED', reasons: [] },
      separationOfDutiesResult: { outcome: 'SATISFIED', checkedAt: '2026-08-31T00:00:00Z' },
    } as unknown as QualityGovernance.QualityGetApprovalBundleSnapshotResult);
    await expect(
      validateDraftAuthorities(definition(), context(), ports, PROJECT),
    ).rejects.toMatchObject({ code: RELEASE_APPROVAL_BUNDLE_INVALID });
  });

  it('accepts a package SnapshotRef whose snapshotId is distinct from its package objectId', () => {
    const ref: Common.ReleasePackageRef = {
      releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d30f'),
      packageSnapshotRef: {
        ...snapshotRef('release.release_package', '018f22e2-7c15-7b2e-8d86-2de956a9d310', 0x51),
        snapshotId: '018f22e2-7c15-7b2e-8d86-2de956a9d311',
      },
      packageHash: hash(0x51),
    };
    expect(validateReleasePackageRef(ref, context())).toEqual(ref);
  });
});
