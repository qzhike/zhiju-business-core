import { describe, expect, it } from 'vitest';
import type { Common, QualityGovernance } from '@zhiju/contracts';
import type { QualityTransactionContext } from '../persistence/quality-db.js';
import {
  QUALITY_EVIDENCE_SCOPE_INVALID,
  QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
  QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
  QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
  QUALITY_PROFILE_DEPENDENCY_CYCLE,
  QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
  QUALITY_PROFILE_SCOPE_INVALID,
  QualityBusinessError,
} from './quality-business-errors.js';
import {
  validateEvidenceCandidate,
  validateEvidenceLink,
  validateEvidenceVerification,
  validateProfileActivation,
  validateQualityProfileDefinition,
} from './quality-business-validation.js';

const ENTERPRISE = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const PROJECT = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const PRINCIPAL = '018f22e2-7c15-7b2e-8d86-2de956a9d203';
const ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9d204';
const DECISION = '018f22e2-7c15-7b2e-8d86-2de956a9d205';
const CORRELATION = '018f22e2-7c15-7b2e-8d86-2de956a9d206';
const SOURCE_OBJECT = '018f22e2-7c15-7b2e-8d86-2de956a9d207';
const SOURCE_SNAPSHOT_OBJECT = '018f22e2-7c15-7b2e-8d86-2de956a9d208';
const SOURCE_SNAPSHOT = '018f22e2-7c15-7b2e-8d86-2de956a9d209';
const EVIDENCE = '018f22e2-7c15-7b2e-8d86-2de956a9d20a';
const CLAIM = '018f22e2-7c15-7b2e-8d86-2de956a9d20b';
const GATE_A = '018f22e2-7c15-7b2e-8d86-2de956a9d20c';
const GATE_B = '018f22e2-7c15-7b2e-8d86-2de956a9d20d';

const context: QualityTransactionContext = {
  kind: 'REQUEST',
  principalId: PRINCIPAL,
  principalKind: 'HUMAN',
  actorSnapshotId: ACTOR,
  authorizationDecisionId: DECISION,
  authorizationDecisionHash: Buffer.alloc(32, 0x11),
  authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  policySnapshotId: '018f22e2-7c15-7b2e-8d86-2de956a9d20e',
  enterpriseId: ENTERPRISE,
  allowedProjectIds: [PROJECT],
  correlationId: CORRELATION,
};

function contentHash(digit: string): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: digit.repeat(64).slice(0, 64),
    canonicalizationVersion: '1',
  };
}

function candidate(): QualityGovernance.EvidenceCandidate {
  return {
    sourceType: 'regulatory.canonical',
    sourceObjectRef: {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'regulatory.canonical_text',
      objectId: SOURCE_OBJECT,
      scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
      contentHash: contentHash('2'),
    },
    sourceSnapshotRef: {
      kind: 'SNAPSHOT',
      objectType: 'regulatory.canonical_text',
      objectId: SOURCE_SNAPSHOT_OBJECT,
      snapshotId: SOURCE_SNAPSHOT,
      scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
      contentHash: contentHash('3'),
    },
    sourceVersion: '1.0.0',
    locator: 'regulatory.canonical/2024.10/claim',
    capturedContentRef: 'quality-evidence/018f22e2/claim.txt',
    capturedContentHash: contentHash('4'),
    authority: 'regulatory.iso',
    accessClassification: 'regulatory.confidential',
    capturedAt: '2026-08-17T00:00:00Z',
  };
}

function gate(gateSpecId: string, dependencies: readonly string[], mandatory = true) {
  return {
    gateSpecId,
    gateType: 'STRUCTURAL_SCHEMA',
    gateVersion: '1.0.0',
    evaluationStage: 'REVISION_ACCEPTANCE',
    mandatory,
    applicabilityRule: { kind: 'always' },
    inputContract: { objectType: 'ArtifactRevision' },
    evaluatorPolicy: { principalKind: 'SERVICE' },
    passCriteria: { outcome: 'PASS' },
    failureSeverity: 'MAJOR',
    blockingRule: { outcomes: ['FAIL', 'ERROR'] },
    dependencyGateSpecIds: dependencies,
    rerunRule: { onChange: 'FULL' },
    resultRetentionRule: { retain: 'regulated' },
  };
}

function profile(
  releaseRequirements: QualityGovernance.QualityProfileDefinition['releaseRequirements'] = [
    {
      purpose: 'formal_release',
      formats: ['DOCX'],
      recipientScope: { enterpriseId: ENTERPRISE },
      validity: { validFrom: '2026-01-01T00:00:00Z', validTo: '2027-01-01T00:00:00Z' },
      receiptRequired: true,
    },
  ],
): QualityGovernance.QualityProfileDefinition {
  return {
    name: 'QMS_PROCEDURE_HIGH',
    profileVersion: '3.0.0',
    applicableArtifactTypes: ['artifact.dhf_section'],
    riskApplicability: { riskLevels: ['HIGH'] },
    gateSpecs: [gate(GATE_A, []), gate(GATE_B, [GATE_A])],
    gateDependencies: [],
    rerunPolicy: { rerunOnChange: 'FULL' },
    issuePolicy: { blockingLevels: ['CRITICAL', 'MAJOR'] },
    separationOfDutiesPolicy: { authorMayReviewOwnWork: false },
    approvalRequirements: [
      { requiredRole: 'quality.reviewer', requiredCount: 2, approverKind: 'HUMAN' },
    ],
    releaseRequirements,
  };
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('expected a QualityBusinessError');
  } catch (error) {
    expect(error).toBeInstanceOf(QualityBusinessError);
    expect((error as QualityBusinessError).code).toBe(code);
  }
}

describe('QualityGovernance WI-02 validation', () => {
  it('rejects incomplete source custody before a root can be created', () => {
    const invalid = { ...candidate(), capturedContentRef: '' };
    expectCode(
      () => validateEvidenceCandidate(invalid, context),
      QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
    );
  });

  it('computes a stable candidate payload hash while preserving exact source facts', () => {
    const validated = validateEvidenceCandidate(candidate(), context);
    expect(validated.scope).toEqual({ enterpriseId: ENTERPRISE, projectId: PROJECT });
    expect(validated.candidate.capturedContentHash.digest).toBe('4'.repeat(64));
    expect(validated.payloadHash).toHaveLength(32);
  });

  it('rejects a source scope that differs from the source snapshot', () => {
    const invalid = {
      ...candidate(),
      sourceObjectRef: {
        ...candidate().sourceObjectRef,
        scope: { enterpriseId: ENTERPRISE },
      },
    };
    expectCode(() => validateEvidenceCandidate(invalid, context), QUALITY_EVIDENCE_SCOPE_INVALID);
  });

  it('rejects an Agent verifier and accepts a trusted Human verifier', () => {
    const verification = {
      method: 'regulatory.cross_reference',
      verifier: { principalKind: 'AGENT', principalId: PRINCIPAL },
      verificationPolicyRef: {
        kind: 'VERSIONED',
        objectType: 'quality.verification_policy',
        objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d20f',
        versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d210',
        scope: { enterpriseId: ENTERPRISE },
      },
      outcome: 'VERIFIED',
      evidenceRefs: [],
      reasons: ['QUALITY_EVIDENCE_VERIFIED'],
      verifiedAt: '2026-08-17T00:00:00Z',
    };
    expectCode(
      () => validateEvidenceVerification(verification, context),
      QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
    );
    const serviceContext = { ...context, principalKind: 'SERVICE' as const };
    expectCode(
      () =>
        validateEvidenceVerification(
          {
            ...verification,
            method: 'manual.cross_reference',
            verifier: { principalKind: 'SERVICE', principalId: PRINCIPAL },
          },
          serviceContext,
        ),
      QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
    );
    const accepted = validateEvidenceVerification(
      { ...verification, verifier: { principalKind: 'HUMAN', principalId: PRINCIPAL } },
      context,
    );
    expect(accepted.verification.verifier.principalKind).toBe('HUMAN');
  });

  it('rejects cross-Project EvidenceLink targets', () => {
    const definition = {
      evidenceRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'quality.evidence',
        objectId: EVIDENCE,
        scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
        contentHash: contentHash('1'),
      },
      targetRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'artifact.claim',
        objectId: CLAIM,
        scope: { enterpriseId: ENTERPRISE, projectId: '018f22e2-7c15-7b2e-8d86-2de956a9d211' },
        contentHash: contentHash('2'),
      },
      claimLocator: '/claims/1',
      claimHash: contentHash('3'),
      relation: 'SUPPORTS',
      applicabilityScope: { enterpriseId: ENTERPRISE },
      linkedAt: '2026-08-17T00:00:00Z',
    };
    expectCode(
      () => validateEvidenceLink(definition, context),
      QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
    );
  });

  it('rejects cycles, missing gate shape, and incomplete separation policy', () => {
    const cyclic = {
      ...profile(),
      gateSpecs: [gate(GATE_A, [GATE_B]), gate(GATE_B, [GATE_A])],
    };
    expectCode(() => validateQualityProfileDefinition(cyclic), QUALITY_PROFILE_DEPENDENCY_CYCLE);
    expectCode(
      () => validateQualityProfileDefinition({ ...profile(), gateSpecs: [{ gateSpecId: GATE_A }] }),
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
    );
    expectCode(
      () =>
        validateQualityProfileDefinition({
          ...profile(),
          separationOfDutiesPolicy: { mode: 'open' },
        }),
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
    );
  });

  it('requires a complete release requirement shape when one is supplied', () => {
    expectCode(
      () =>
        validateQualityProfileDefinition({
          ...profile(),
          releaseRequirements: [{ purpose: 'formal_release' }],
        }),
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
    );
  });

  it('requires an Enterprise profile ref and field-specific activation snapshots', () => {
    const activation = {
      profileVersionRef: {
        kind: 'VERSIONED',
        objectType: 'quality.quality_profile',
        objectId: EVIDENCE,
        versionId: GATE_A,
        scope: { enterpriseId: ENTERPRISE },
      },
      reviewSnapshotRef: {
        kind: 'SNAPSHOT',
        objectType: 'quality.quality_profile_review',
        objectId: SOURCE_SNAPSHOT_OBJECT,
        snapshotId: SOURCE_SNAPSHOT,
        scope: { enterpriseId: ENTERPRISE },
        contentHash: contentHash('5'),
      },
      validationSnapshotRef: {
        kind: 'SNAPSHOT',
        objectType: 'quality.quality_profile_validation',
        objectId: SOURCE_SNAPSHOT_OBJECT,
        snapshotId: SOURCE_SNAPSHOT,
        scope: { enterpriseId: ENTERPRISE },
        contentHash: contentHash('6'),
      },
      activatedAt: '2026-08-17T00:00:00Z',
    };
    expect(validateProfileActivation(activation, context).profileVersionRef.scope).toEqual({
      enterpriseId: ENTERPRISE,
    });
    expectCode(
      () =>
        validateProfileActivation(
          {
            ...activation,
            profileVersionRef: {
              ...activation.profileVersionRef,
              scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
            },
          },
          context,
        ),
      QUALITY_PROFILE_SCOPE_INVALID,
    );
    expectCode(
      () =>
        validateProfileActivation(
          { ...activation, reviewSnapshotRef: activation.validationSnapshotRef },
          context,
        ),
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
    );
  });
});
