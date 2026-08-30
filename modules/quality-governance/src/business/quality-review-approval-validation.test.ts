import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Common, QualityGovernance } from '@zhiju/contracts';
import { canonicalize, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { QualityTransactionContext } from '../persistence/quality-db.js';
import {
  QUALITY_APPROVAL_AGENT_FORBIDDEN,
  QUALITY_APPROVAL_INVALID,
  QUALITY_APPROVAL_REVISION_MISMATCH,
  QUALITY_REVIEW_ISSUE_INVALID,
  QUALITY_SEPARATION_OF_DUTIES_VIOLATION,
  QualityBusinessError,
} from './quality-business-errors.js';
import {
  validateApprovalRequestDefinition,
  validateApprovalRevocation,
  validateApprovalSubmission,
  validateIssueResolution,
  validateIssueVerification,
  validateReviewIssueDefinition,
} from './quality-review-approval-validation.js';

const ENTERPRISE = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const PROJECT = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const OTHER_PROJECT = '018f22e2-7c15-7b2e-8d86-2de956a9d203';
const PRINCIPAL = '018f22e2-7c15-7b2e-8d86-2de956a9d204';
const ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9d205';
const DECISION = '018f22e2-7c15-7b2e-8d86-2de956a9d206';
const CORRELATION = '018f22e2-7c15-7b2e-8d86-2de956a9d207';
const ARTIFACT = '018f22e2-7c15-7b2e-8d86-2de956a9d208';
const ORIGIN_REVISION = '018f22e2-7c15-7b2e-8d86-2de956a9d209';
const TARGET_REVISION = '018f22e2-7c15-7b2e-8d86-2de956a9d20a';
const CLAIM = '018f22e2-7c15-7b2e-8d86-2de956a9d20b';
const PROFILE = '018f22e2-7c15-7b2e-8d86-2de956a9d20c';
const PROFILE_VERSION = '018f22e2-7c15-7b2e-8d86-2de956a9d20d';
const REQUIREMENT = '018f22e2-7c15-7b2e-8d86-2de956a9d20e';
const RAS = '018f22e2-7c15-7b2e-8d86-2de956a9d20f';
const RAS_SNAPSHOT = '018f22e2-7c15-7b2e-8d86-2de956a9d210';
const ROLE_SNAPSHOT = '018f22e2-7c15-7b2e-8d86-2de956a9d211';
const AUTHORIZATION_DECISION = '018f22e2-7c15-7b2e-8d86-2de956a9d212';
const SEPARATION_CHECK = '018f22e2-7c15-7b2e-8d86-2de956a9d213';
const IMPACT_ASSESSMENT = '018f22e2-7c15-7b2e-8d86-2de956a9d214';
const REQUEST = '018f22e2-7c15-7b2e-8d86-2de956a9d215';

const context: QualityTransactionContext = {
  kind: 'REQUEST',
  principalId: PRINCIPAL,
  principalKind: 'HUMAN',
  actorSnapshotId: ACTOR,
  authorizationDecisionId: DECISION,
  authorizationDecisionHash: Buffer.alloc(32, 0x11),
  authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  policySnapshotId: '018f22e2-7c15-7b2e-8d86-2de956a9d216',
  enterpriseId: ENTERPRISE,
  allowedProjectIds: [PROJECT, OTHER_PROJECT],
  correlationId: CORRELATION,
};

function hash(byte: number): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: Buffer.alloc(32, byte).toString('hex'),
    canonicalizationVersion: '1',
  };
}

function objectRef(objectType: string, objectId: string, projectId = PROJECT): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType,
    objectId,
    scope: { enterpriseId: ENTERPRISE, projectId },
  };
}

function contentRef(
  objectType: string,
  objectId: string,
  byte: number,
  projectId = PROJECT,
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId,
    scope: { enterpriseId: ENTERPRISE, projectId },
    contentHash: hash(byte),
  };
}

function snapshotRef(
  objectType: string,
  objectId: string,
  snapshotId: string,
  byte: number,
  projectId = PROJECT,
): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId,
    snapshotId,
    scope: { enterpriseId: ENTERPRISE, projectId },
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

function reviewIssueDefinition(): QualityGovernance.ReviewIssueDefinition {
  return {
    artifactRef: objectRef('artifact.artifact', ARTIFACT),
    originRevisionRef: contentRef('artifact.artifact_revision', ORIGIN_REVISION, 0x21),
    issueType: 'quality.schema_violation',
    severity: 'MAJOR',
    blockingClassification: 'quality.blocking',
    statement: 'The revision contains a blocking schema violation.',
    locator: 'artifact.revision/claims/1',
    evidenceRefs: [],
    raisedAt: '2026-08-30T00:00:00Z',
  };
}

function resolution(): QualityGovernance.IssueResolution {
  return {
    targetRevisionRef: contentRef('artifact.artifact_revision', TARGET_REVISION, 0x31),
    changedClaimRefs: [],
    explanation: 'The target revision contains the corrected claim shape.',
    proposedAt: '2026-08-30T00:01:00Z',
  };
}

function verification(): QualityGovernance.IssueVerification {
  return {
    targetRevisionRef: resolution().targetRevisionRef,
    verifier: { principalKind: 'HUMAN', principalId: PRINCIPAL },
    verificationMethod: 'quality.manual_review',
    supportingGateResultRefs: [],
    outcome: 'VERIFIED',
    verifiedAt: '2026-08-30T00:02:00Z',
  };
}

function approvalRequestDefinition(): QualityGovernance.ApprovalRequestDefinition {
  return {
    artifactRef: objectRef('artifact.artifact', ARTIFACT),
    revisionRef: resolution().targetRevisionRef,
    revisionAcceptanceSnapshotRef: snapshotRef(
      'quality.revision_acceptance_snapshot',
      RAS,
      RAS_SNAPSHOT,
      0x41,
    ),
    qualityProfileRef: profileRef(),
    approvalRequirementId: REQUIREMENT,
    requestedApproverRole: 'quality.reviewer',
    requestNonceHash: hash(0x42),
  };
}

function approvalSubmission(): QualityGovernance.ApprovalSubmission {
  const requestDefinition = approvalRequestDefinition();
  return {
    requestRef: objectRef('quality.approval_request', REQUEST),
    revisionRef: requestDefinition.revisionRef,
    revisionAcceptanceSnapshotRef: requestDefinition.revisionAcceptanceSnapshotRef,
    approvalRequirementId: REQUIREMENT,
    decision: 'APPROVED',
    decisionComment: 'The exact revision and acceptance snapshot were reviewed.',
    approverHumanPrincipalRef: { principalKind: 'HUMAN', principalId: PRINCIPAL },
    approverRoleSnapshotRef: snapshotRef(
      'identity.role_assignment',
      ROLE_SNAPSHOT,
      '018f22e2-7c15-7b2e-8d86-2de956a9d217',
      0x43,
    ),
    authorizationDecisionRef: contentRef(
      'identity.authorization_decision',
      AUTHORIZATION_DECISION,
      0x44,
    ),
    separationCheckRef: contentRef('quality.separation_check', SEPARATION_CHECK, 0x45),
    decidedAt: '2026-08-30T00:03:00Z',
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

describe('QualityGovernance WI-04 validation', () => {
  it('accepts an exact ReviewIssue and hashes its normalized canonical definition', () => {
    const validated = validateReviewIssueDefinition(reviewIssueDefinition(), context);

    expect(validated.scope).toEqual({ enterpriseId: ENTERPRISE, projectId: PROJECT });
    expect(validated.originRevisionHash).toEqual(Buffer.from(hash(0x21).digest, 'hex'));
    expect(validated.payloadHash).toEqual(
      createHash('sha256')
        .update(canonicalize(validated.definition as unknown as CanonicalJsonObject), 'utf8')
        .digest(),
    );
  });

  it('rejects a namespace code that violates the Common scalar format', () => {
    expectCode(
      () =>
        validateReviewIssueDefinition(
          { ...reviewIssueDefinition(), issueType: 'quality-invalid-type' },
          context,
        ),
      QUALITY_REVIEW_ISSUE_INVALID,
    );
  });

  it('rejects cross-scope origin gate, claim, and supporting gate references', () => {
    expectCode(
      () =>
        validateReviewIssueDefinition(
          {
            ...reviewIssueDefinition(),
            originGateResultRef: contentRef(
              'quality.gate_result',
              '018f22e2-7c15-7b2e-8d86-2de956a9d218',
              0x22,
              OTHER_PROJECT,
            ),
          },
          context,
        ),
      QUALITY_REVIEW_ISSUE_INVALID,
    );

    expectCode(
      () =>
        validateIssueResolution(
          {
            ...resolution(),
            changedClaimRefs: [contentRef('artifact.claim', CLAIM, 0x23, OTHER_PROJECT)],
          },
          { principalKind: 'HUMAN', principalId: PRINCIPAL },
          context,
        ),
      QUALITY_REVIEW_ISSUE_INVALID,
    );

    expectCode(
      () =>
        validateIssueVerification(
          {
            ...verification(),
            supportingGateResultRefs: [
              contentRef(
                'quality.gate_result',
                '018f22e2-7c15-7b2e-8d86-2de956a9d219',
                0x24,
                OTHER_PROJECT,
              ),
            ],
          },
          context,
        ),
      QUALITY_REVIEW_ISSUE_INVALID,
    );
  });

  it('validates exact Approval Request references and canonical nonce hash', () => {
    const validated = validateApprovalRequestDefinition(approvalRequestDefinition(), context);

    expect(validated.scope).toEqual({ enterpriseId: ENTERPRISE, projectId: PROJECT });
    expect(validated.requestNonceHash).toEqual(Buffer.from(hash(0x42).digest, 'hex'));
    expect(validated.payloadHash).toHaveLength(32);
  });

  it('accepts a Human Approval submission and permanently rejects an Agent approver', () => {
    const validated = validateApprovalSubmission(approvalSubmission(), context);

    expect(validated.submission.approverHumanPrincipalRef.principalKind).toBe('HUMAN');
    expect(validated.revisionContentHash).toEqual(Buffer.from(hash(0x31).digest, 'hex'));

    expectCode(
      () =>
        validateApprovalSubmission(
          {
            ...approvalSubmission(),
            approverHumanPrincipalRef: {
              principalKind: 'AGENT',
              principalId: PRINCIPAL,
            },
          },
          context,
        ),
      QUALITY_APPROVAL_AGENT_FORBIDDEN,
    );
  });

  it('rejects an Approval submission with a wrong request scope or exact object type', () => {
    expectCode(
      () =>
        validateApprovalSubmission(
          {
            ...approvalSubmission(),
            requestRef: objectRef('quality.approval_request', REQUEST, OTHER_PROJECT),
          },
          context,
        ),
      QUALITY_APPROVAL_REVISION_MISMATCH,
    );

    expectCode(
      () =>
        validateApprovalSubmission(
          {
            ...approvalSubmission(),
            separationCheckRef: contentRef(
              'quality.authorization_decision',
              SEPARATION_CHECK,
              0x45,
            ),
          },
          context,
        ),
      QUALITY_SEPARATION_OF_DUTIES_VIOLATION,
    );
  });

  it('validates revocation justification, impact reference, and revoked time', () => {
    const validated = validateApprovalRevocation(
      {
        revocationReason: {
          reasonCode: 'QUALITY_APPROVAL_REVOKED',
          summary: 'The approval is no longer valid after an impact assessment.',
          evidenceRefs: [],
        },
        impactAssessmentRef: contentRef('quality.impact_assessment', IMPACT_ASSESSMENT, 0x51),
        revokedAt: '2026-08-30T00:04:00Z',
      },
      context,
    );

    expect(validated.revokedAtText).toBe('2026-08-30T00:04:00Z');
    expect(validated.payloadHash).toHaveLength(32);

    expectCode(
      () =>
        validateApprovalRevocation(
          {
            revocationReason: {
              reasonCode: 'QUALITY_APPROVAL_REVOKED',
              summary: 'The approval is no longer valid after an impact assessment.',
              evidenceRefs: [],
            },
            impactAssessmentRef: contentRef(
              'quality.not_an_impact_assessment',
              IMPACT_ASSESSMENT,
              0x51,
            ),
            revokedAt: '2026-08-30T00:04:00Z',
          },
          context,
        ),
      QUALITY_APPROVAL_INVALID,
    );
  });
});
