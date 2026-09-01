// IM-05 WI-02 (issue #122): repository for the business write functions and
// exact RLS reads. Business INSERT/UPDATE statements are intentionally absent
// from this file; all mutations cross the owner-function boundary created by
// V5002.

import { sql } from 'kysely';
import type {
  ApprovalBundleSnapshotTable,
  ApprovalDecisionTable,
  ApprovalRequestTable,
  ApprovalRevocationTable,
  ApprovalTable,
  ChangeImpactTable,
  EvidenceLinkTable,
  EvidenceRevocationTable,
  EvidenceTable,
  EvidenceValidationTable,
  GateInvalidationTable,
  GateResultReuseTable,
  GateResultTable,
  IssueObservationTable,
  IssueStateTransitionTable,
  QualityProfileApprovalRequirementTable,
  QualityProfileGateDependencyTable,
  QualityProfileGateSpecTable,
  QualityProfileReleaseRequirementTable,
  QualityProfileTable,
  QualityProfileVersionTable,
  ReleaseReadinessSnapshotTable,
  ResolutionProposalTable,
  ReviewIssueTable,
  RevisionAcceptanceSnapshotTable,
  VerificationRecordTable,
} from './quality-business-types.js';
import type { QualityTransaction } from './quality-db.js';

function json(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string')
    throw new TypeError('business JSON value cannot be undefined');
  return serialized;
}

export interface EvidenceInsert {
  readonly evidenceId: string;
  readonly enterpriseId: string;
  readonly projectId?: string;
  readonly candidate: unknown;
  readonly candidatePayloadHash: Buffer;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface EvidenceVerificationAppend {
  readonly validationId: string;
  readonly evidenceId: string;
  readonly evidencePayloadHash: Buffer;
  readonly expectedVersion: string;
  readonly verification: unknown;
  readonly verificationPayloadHash: Buffer;
  readonly outcome: 'VERIFIED' | 'DISPUTED';
  readonly verifiedAt: Date;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface EvidenceRevocationAppend {
  readonly revocationId: string;
  readonly evidenceId: string;
  readonly evidencePayloadHash: Buffer;
  readonly expectedVersion: string;
  readonly revocationReason: unknown;
  readonly impactAssessmentRef: unknown;
  readonly revokedAt: Date;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface EvidenceLinkInsert {
  readonly evidenceLinkId: string;
  readonly evidenceId: string;
  readonly evidencePayloadHash: Buffer;
  readonly definition: unknown;
  readonly claimHash: Buffer;
  readonly enterpriseId: string;
  readonly projectId?: string;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface QualityProfileDraftInsert {
  readonly profileId: string;
  readonly profileVersionId: string;
  readonly enterpriseId: string;
  readonly definition: unknown;
  readonly definitionHash: Buffer;
  readonly expectedVersion?: string;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface QualityProfileActivation {
  readonly profileId: string;
  readonly profileVersionId: string;
  readonly expectedVersion: string;
  readonly reviewSnapshotRef: unknown;
  readonly validationSnapshotRef: unknown;
  readonly activatedAt: Date;
  readonly updatedByPrincipalId: string;
  readonly updatedByActorSnapshotId: string;
  readonly updatedAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface ChangeImpactInsert {
  readonly changeImpactId: string;
  readonly enterpriseId: string;
  readonly projectId?: string;
  readonly definition: unknown;
  readonly payloadHash: Buffer;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdByAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface GateResultInsert {
  readonly gateResultId: string;
  readonly enterpriseId: string;
  readonly projectId?: string;
  readonly definition: unknown;
  readonly revisionContentHash: Buffer;
  readonly evaluationStage: 'REVISION_ACCEPTANCE' | 'RELEASE_READINESS';
  readonly executionMode: 'EXECUTED' | 'REUSED_BY_IMPACT_ANALYSIS';
  readonly payloadHash: Buffer;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdByAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface GateResultReuseInsert {
  readonly reuseId: string;
  readonly gateResultId: string;
  readonly enterpriseId: string;
  readonly projectId?: string;
  readonly sourceGateResultRef: unknown;
  readonly sourceGateResultHash: Buffer;
  readonly changeImpactRef: unknown;
  readonly changeImpactHash: Buffer;
  readonly coverageProof: unknown;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdByAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface GateInvalidationInsert {
  readonly invalidationId: string;
  readonly gateResultId: string;
  readonly enterpriseId: string;
  readonly projectId?: string;
  readonly gateResultRef: unknown;
  readonly gateResultHash: Buffer;
  readonly invalidationReason: unknown;
  readonly impactAssessmentRef: unknown;
  readonly invalidatedAt: Date;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdByAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface ReadinessSnapshotInsert {
  readonly snapshotId: string;
  readonly enterpriseId: string;
  readonly projectId?: string;
  readonly snapshot: unknown;
  readonly revisionContentHash: Buffer;
  readonly payloadHash: Buffer;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdByAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface ReviewIssueInsert {
  readonly reviewIssueId: string;
  readonly enterpriseId: string;
  readonly projectId?: string;
  readonly definition: unknown;
  readonly raisedBy: unknown;
  readonly payloadHash: Buffer;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface IssueResolutionAppend {
  readonly resolutionId: string;
  readonly reviewIssueId: string;
  readonly expectedVersion: string;
  readonly definition: unknown;
  readonly payloadHash: Buffer;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface IssueVerificationAppend {
  readonly verificationId: string;
  readonly reviewIssueId: string;
  readonly resolutionId: string;
  readonly expectedVersion: string;
  readonly definition: unknown;
  readonly payloadHash: Buffer;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface ReviewIssueClose {
  readonly reviewIssueId: string;
  readonly expectedVersion: string;
  readonly verificationRef: unknown;
  readonly verificationHash: Buffer;
  readonly closeReason: unknown;
  readonly closedAt: Date;
  readonly transitionId: string;
  readonly payloadHash: Buffer;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface ApprovalRequestInsert {
  readonly requestId: string;
  readonly enterpriseId: string;
  readonly projectId?: string;
  readonly definition: unknown;
  readonly payloadHash: Buffer;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface ApprovalDecisionInsert {
  readonly approvalId: string;
  readonly requestId: string;
  readonly definition: unknown;
  readonly payloadHash: Buffer;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface ApprovalRevocationAppend {
  readonly revocationId: string;
  readonly approvalId: string;
  readonly expectedVersion: string;
  readonly definition: unknown;
  readonly payloadHash: Buffer;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface ApprovalBundleSnapshotInsert {
  readonly snapshotId: string;
  readonly enterpriseId: string;
  readonly projectId?: string;
  readonly snapshot: unknown;
  readonly revisionContentHash: Buffer;
  readonly payloadHash: Buffer;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface AggregateWriteResult {
  readonly outcome: BusinessWriteOutcome;
  readonly aggregateVersion?: string;
}

export type BusinessWriteOutcome =
  'OK' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID' | 'ALREADY' | 'CONTEXT_REJECTED';

export interface ProfileDraftWriteResult {
  readonly outcome: BusinessWriteOutcome;
  readonly profileVersionId?: string;
  readonly aggregateVersion?: string;
}

export class QualityBusinessRepository {
  async insertEvidence(
    trx: QualityTransaction,
    input: EvidenceInsert,
  ): Promise<BusinessWriteOutcome> {
    const result = await sql<{ outcome: BusinessWriteOutcome }>`
      SELECT outcome
      FROM quality_governance.create_evidence(
        ${input.evidenceId}::uuid,
        ${input.enterpriseId}::uuid,
        ${input.projectId ?? null}::uuid,
        ${json(input.candidate)}::jsonb,
        ${input.candidatePayloadHash}::bytea,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'INVALID';
  }

  async appendEvidenceVerification(
    trx: QualityTransaction,
    input: EvidenceVerificationAppend,
  ): Promise<BusinessWriteOutcome> {
    const result = await sql<{ outcome: BusinessWriteOutcome }>`
      SELECT outcome
      FROM quality_governance.append_evidence_verification(
        ${input.validationId}::uuid,
        ${input.evidenceId}::uuid,
        ${input.evidencePayloadHash}::bytea,
        ${input.expectedVersion}::bigint,
        ${json(input.verification)}::jsonb,
        ${input.verificationPayloadHash}::bytea,
        ${input.outcome}::text,
        ${input.verifiedAt}::timestamptz,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'INVALID';
  }

  async appendEvidenceRevocation(
    trx: QualityTransaction,
    input: EvidenceRevocationAppend,
  ): Promise<BusinessWriteOutcome> {
    const result = await sql<{ outcome: BusinessWriteOutcome }>`
      SELECT outcome
      FROM quality_governance.append_evidence_revocation(
        ${input.revocationId}::uuid,
        ${input.evidenceId}::uuid,
        ${input.evidencePayloadHash}::bytea,
        ${input.expectedVersion}::bigint,
        ${json(input.revocationReason)}::jsonb,
        ${json(input.impactAssessmentRef)}::jsonb,
        ${input.revokedAt}::timestamptz,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'INVALID';
  }

  async insertEvidenceLink(
    trx: QualityTransaction,
    input: EvidenceLinkInsert,
  ): Promise<BusinessWriteOutcome> {
    const result = await sql<{ outcome: BusinessWriteOutcome }>`
      SELECT outcome
      FROM quality_governance.create_evidence_link(
        ${input.evidenceLinkId}::uuid,
        ${input.evidenceId}::uuid,
        ${input.evidencePayloadHash}::bytea,
        ${json(input.definition)}::jsonb,
        ${input.claimHash}::bytea,
        ${input.enterpriseId}::uuid,
        ${input.projectId ?? null}::uuid,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'INVALID';
  }

  async insertQualityProfileDraft(
    trx: QualityTransaction,
    input: QualityProfileDraftInsert,
  ): Promise<ProfileDraftWriteResult> {
    const result = await sql<{
      outcome: BusinessWriteOutcome;
      profile_version_id: string | null;
      aggregate_version: string | null;
    }>`
      SELECT outcome, profile_version_id, aggregate_version::text
      FROM quality_governance.create_quality_profile_draft(
        ${input.profileId}::uuid,
        ${input.profileVersionId}::uuid,
        ${input.enterpriseId}::uuid,
        ${json(input.definition)}::jsonb,
        ${input.definitionHash}::bytea,
        ${input.expectedVersion ?? null}::bigint,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    const row = result.rows[0];
    return {
      outcome: row?.outcome ?? 'INVALID',
      ...(row?.profile_version_id === null || row?.profile_version_id === undefined
        ? {}
        : { profileVersionId: row.profile_version_id }),
      ...(row?.aggregate_version === null || row?.aggregate_version === undefined
        ? {}
        : { aggregateVersion: row.aggregate_version }),
    };
  }

  async activateQualityProfile(
    trx: QualityTransaction,
    input: QualityProfileActivation,
  ): Promise<BusinessWriteOutcome> {
    const result = await sql<{ outcome: BusinessWriteOutcome }>`
      SELECT outcome
      FROM quality_governance.activate_quality_profile(
        ${input.profileId}::uuid,
        ${input.profileVersionId}::uuid,
        ${input.expectedVersion}::bigint,
        ${json(input.reviewSnapshotRef)}::jsonb,
        ${json(input.validationSnapshotRef)}::jsonb,
        ${input.activatedAt}::timestamptz,
        ${input.updatedByPrincipalId}::uuid,
        ${input.updatedByActorSnapshotId}::uuid,
        ${input.updatedAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'INVALID';
  }

  async insertChangeImpact(
    trx: QualityTransaction,
    input: ChangeImpactInsert,
  ): Promise<BusinessWriteOutcome> {
    const result = await sql<{ outcome: BusinessWriteOutcome }>`
      SELECT outcome
      FROM quality_governance.create_change_impact(
        ${input.changeImpactId}::uuid,
        ${input.enterpriseId}::uuid,
        ${input.projectId ?? null}::uuid,
        ${json(input.definition)}::jsonb,
        ${input.payloadHash}::bytea,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdByAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'INVALID';
  }

  async insertGateResult(
    trx: QualityTransaction,
    input: GateResultInsert,
  ): Promise<BusinessWriteOutcome> {
    const result = await sql<{ outcome: BusinessWriteOutcome }>`
      SELECT outcome
      FROM quality_governance.create_gate_result(
        ${input.gateResultId}::uuid,
        ${input.enterpriseId}::uuid,
        ${input.projectId ?? null}::uuid,
        ${json(input.definition)}::jsonb,
        ${input.revisionContentHash}::bytea,
        ${input.evaluationStage}::text,
        ${input.executionMode}::text,
        ${input.payloadHash}::bytea,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdByAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'INVALID';
  }

  async insertGateResultReuse(
    trx: QualityTransaction,
    input: GateResultReuseInsert,
  ): Promise<BusinessWriteOutcome> {
    const result = await sql<{ outcome: BusinessWriteOutcome }>`
      SELECT outcome
      FROM quality_governance.create_gate_result_reuse(
        ${input.reuseId}::uuid,
        ${input.gateResultId}::uuid,
        ${input.enterpriseId}::uuid,
        ${input.projectId ?? null}::uuid,
        ${json(input.sourceGateResultRef)}::jsonb,
        ${input.sourceGateResultHash}::bytea,
        ${json(input.changeImpactRef)}::jsonb,
        ${input.changeImpactHash}::bytea,
        ${json(input.coverageProof)}::jsonb,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdByAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'INVALID';
  }

  async insertGateInvalidation(
    trx: QualityTransaction,
    input: GateInvalidationInsert,
  ): Promise<BusinessWriteOutcome> {
    const result = await sql<{ outcome: BusinessWriteOutcome }>`
      SELECT outcome
      FROM quality_governance.create_gate_invalidation(
        ${input.invalidationId}::uuid,
        ${input.gateResultId}::uuid,
        ${input.enterpriseId}::uuid,
        ${input.projectId ?? null}::uuid,
        ${json(input.gateResultRef)}::jsonb,
        ${input.gateResultHash}::bytea,
        ${json(input.invalidationReason)}::jsonb,
        ${json(input.impactAssessmentRef)}::jsonb,
        ${input.invalidatedAt}::timestamptz,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdByAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'INVALID';
  }

  async insertRevisionAcceptanceSnapshot(
    trx: QualityTransaction,
    input: ReadinessSnapshotInsert,
  ): Promise<BusinessWriteOutcome> {
    const result = await sql<{ outcome: BusinessWriteOutcome }>`
      SELECT outcome
      FROM quality_governance.create_revision_acceptance_snapshot(
        ${input.snapshotId}::uuid,
        ${input.enterpriseId}::uuid,
        ${input.projectId ?? null}::uuid,
        ${json(input.snapshot)}::jsonb,
        ${input.revisionContentHash}::bytea,
        ${input.payloadHash}::bytea,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdByAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'INVALID';
  }

  async insertReleaseReadinessSnapshot(
    trx: QualityTransaction,
    input: ReadinessSnapshotInsert,
  ): Promise<BusinessWriteOutcome> {
    const result = await sql<{ outcome: BusinessWriteOutcome }>`
      SELECT outcome
      FROM quality_governance.create_release_readiness_snapshot(
        ${input.snapshotId}::uuid,
        ${input.enterpriseId}::uuid,
        ${input.projectId ?? null}::uuid,
        ${json(input.snapshot)}::jsonb,
        ${input.revisionContentHash}::bytea,
        ${input.payloadHash}::bytea,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdByAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'INVALID';
  }

  async insertReviewIssue(
    trx: QualityTransaction,
    input: ReviewIssueInsert,
  ): Promise<BusinessWriteOutcome> {
    const result = await sql<{ outcome: BusinessWriteOutcome }>`
      SELECT outcome
      FROM quality_governance.create_review_issue(
        ${input.reviewIssueId}::uuid,
        ${input.enterpriseId}::uuid,
        ${input.projectId ?? null}::uuid,
        ${json(input.definition)}::jsonb,
        ${json(input.raisedBy)}::jsonb,
        ${input.payloadHash}::bytea,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'INVALID';
  }

  async appendIssueResolution(
    trx: QualityTransaction,
    input: IssueResolutionAppend,
  ): Promise<AggregateWriteResult> {
    const result = await sql<{
      outcome: BusinessWriteOutcome;
      aggregate_version: string | null;
    }>`
      SELECT outcome, aggregate_version::text
      FROM quality_governance.append_issue_resolution(
        ${input.resolutionId}::uuid,
        ${input.reviewIssueId}::uuid,
        ${input.expectedVersion}::bigint,
        ${json(input.definition)}::jsonb,
        ${input.payloadHash}::bytea,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    const row = result.rows[0];
    return {
      outcome: row?.outcome ?? 'INVALID',
      ...(row?.aggregate_version === null || row?.aggregate_version === undefined
        ? {}
        : { aggregateVersion: row.aggregate_version }),
    };
  }

  async appendIssueVerification(
    trx: QualityTransaction,
    input: IssueVerificationAppend,
  ): Promise<AggregateWriteResult> {
    const result = await sql<{
      outcome: BusinessWriteOutcome;
      aggregate_version: string | null;
    }>`
      SELECT outcome, aggregate_version::text
      FROM quality_governance.append_issue_verification(
        ${input.verificationId}::uuid,
        ${input.reviewIssueId}::uuid,
        ${input.resolutionId}::uuid,
        ${input.expectedVersion}::bigint,
        ${json(input.definition)}::jsonb,
        ${input.payloadHash}::bytea,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    const row = result.rows[0];
    return {
      outcome: row?.outcome ?? 'INVALID',
      ...(row?.aggregate_version === null || row?.aggregate_version === undefined
        ? {}
        : { aggregateVersion: row.aggregate_version }),
    };
  }

  async closeReviewIssue(
    trx: QualityTransaction,
    input: ReviewIssueClose,
  ): Promise<AggregateWriteResult> {
    const result = await sql<{
      outcome: BusinessWriteOutcome;
      aggregate_version: string | null;
    }>`
      SELECT outcome, aggregate_version::text
      FROM quality_governance.close_review_issue(
        ${input.reviewIssueId}::uuid,
        ${input.expectedVersion}::bigint,
        ${input.verificationRef}::jsonb,
        ${input.verificationHash}::bytea,
        ${json(input.closeReason)}::jsonb,
        ${input.closedAt}::timestamptz,
        ${input.transitionId}::uuid,
        ${input.payloadHash}::bytea,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    const row = result.rows[0];
    return {
      outcome: row?.outcome ?? 'INVALID',
      ...(row?.aggregate_version === null || row?.aggregate_version === undefined
        ? {}
        : { aggregateVersion: row.aggregate_version }),
    };
  }

  async insertApprovalRequest(
    trx: QualityTransaction,
    input: ApprovalRequestInsert,
  ): Promise<BusinessWriteOutcome> {
    const result = await sql<{ outcome: BusinessWriteOutcome }>`
      SELECT outcome
      FROM quality_governance.create_approval_request(
        ${input.requestId}::uuid,
        ${input.enterpriseId}::uuid,
        ${input.projectId ?? null}::uuid,
        ${json(input.definition)}::jsonb,
        ${input.payloadHash}::bytea,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'INVALID';
  }

  async insertApprovalDecision(
    trx: QualityTransaction,
    input: ApprovalDecisionInsert,
  ): Promise<BusinessWriteOutcome> {
    const result = await sql<{ outcome: BusinessWriteOutcome }>`
      SELECT outcome
      FROM quality_governance.create_approval_decision(
        ${input.approvalId}::uuid,
        ${input.requestId}::uuid,
        ${json(input.definition)}::jsonb,
        ${input.payloadHash}::bytea,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'INVALID';
  }

  async appendApprovalRevocation(
    trx: QualityTransaction,
    input: ApprovalRevocationAppend,
  ): Promise<AggregateWriteResult> {
    const result = await sql<{
      outcome: BusinessWriteOutcome;
      aggregate_version: string | null;
    }>`
      SELECT outcome, aggregate_version::text
      FROM quality_governance.append_approval_revocation(
        ${input.revocationId}::uuid,
        ${input.approvalId}::uuid,
        ${input.expectedVersion}::bigint,
        ${json(input.definition)}::jsonb,
        ${input.payloadHash}::bytea,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    const row = result.rows[0];
    return {
      outcome: row?.outcome ?? 'INVALID',
      ...(row?.aggregate_version === null || row?.aggregate_version === undefined
        ? {}
        : { aggregateVersion: row.aggregate_version }),
    };
  }

  async insertApprovalBundleSnapshot(
    trx: QualityTransaction,
    input: ApprovalBundleSnapshotInsert,
  ): Promise<BusinessWriteOutcome> {
    const result = await sql<{ outcome: BusinessWriteOutcome }>`
      SELECT outcome
      FROM quality_governance.create_approval_bundle_snapshot(
        ${input.snapshotId}::uuid,
        ${input.enterpriseId}::uuid,
        ${input.projectId ?? null}::uuid,
        ${json(input.snapshot)}::jsonb,
        ${input.revisionContentHash}::bytea,
        ${input.payloadHash}::bytea,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'INVALID';
  }

  async getEvidenceById(
    trx: QualityTransaction,
    evidenceId: string,
  ): Promise<EvidenceTable | undefined> {
    return trx
      .selectFrom('quality_governance.evidence')
      .selectAll()
      .where('evidence_id', '=', evidenceId)
      .executeTakeFirst();
  }

  async getEvidenceValidations(
    trx: QualityTransaction,
    evidenceId: string,
  ): Promise<readonly EvidenceValidationTable[]> {
    return trx
      .selectFrom('quality_governance.evidence_validation')
      .selectAll()
      .where('evidence_id', '=', evidenceId)
      .orderBy('verified_at', 'desc')
      .orderBy('validation_id', 'desc')
      .execute();
  }

  async getEvidenceRevocations(
    trx: QualityTransaction,
    evidenceId: string,
  ): Promise<readonly EvidenceRevocationTable[]> {
    return trx
      .selectFrom('quality_governance.evidence_revocation')
      .selectAll()
      .where('evidence_id', '=', evidenceId)
      .orderBy('revoked_at', 'desc')
      .execute();
  }

  async getEvidenceLinkByIdentity(
    trx: QualityTransaction,
    evidenceId: string,
    definition: unknown,
  ): Promise<EvidenceLinkTable | undefined> {
    return trx
      .selectFrom('quality_governance.evidence_link')
      .selectAll()
      .where('evidence_id', '=', evidenceId)
      .where('definition', '=', JSON.stringify(definition))
      .executeTakeFirst();
  }

  async getQualityProfileById(
    trx: QualityTransaction,
    profileId: string,
  ): Promise<QualityProfileTable | undefined> {
    return trx
      .selectFrom('quality_governance.quality_profile')
      .selectAll()
      .where('quality_profile_id', '=', profileId)
      .executeTakeFirst();
  }

  async getQualityProfileVersionById(
    trx: QualityTransaction,
    profileVersionId: string,
  ): Promise<QualityProfileVersionTable | undefined> {
    return trx
      .selectFrom('quality_governance.quality_profile_version')
      .selectAll()
      .where('profile_version_id', '=', profileVersionId)
      .executeTakeFirst();
  }

  async getQualityProfileGateSpecs(
    trx: QualityTransaction,
    profileVersionId: string,
  ): Promise<readonly QualityProfileGateSpecTable[]> {
    return trx
      .selectFrom('quality_governance.quality_profile_gate_spec')
      .selectAll()
      .where('profile_version_id', '=', profileVersionId)
      .orderBy('gate_spec_id')
      .execute();
  }

  async getQualityProfileDependencies(
    trx: QualityTransaction,
    profileVersionId: string,
  ): Promise<readonly QualityProfileGateDependencyTable[]> {
    return trx
      .selectFrom('quality_governance.quality_profile_gate_dependency')
      .selectAll()
      .where('profile_version_id', '=', profileVersionId)
      .orderBy('dependency_id')
      .execute();
  }

  async getQualityProfileApprovalRequirements(
    trx: QualityTransaction,
    profileVersionId: string,
  ): Promise<readonly QualityProfileApprovalRequirementTable[]> {
    return trx
      .selectFrom('quality_governance.quality_profile_approval_requirement')
      .selectAll()
      .where('profile_version_id', '=', profileVersionId)
      .orderBy('requirement_order')
      .execute();
  }

  async getQualityProfileReleaseRequirements(
    trx: QualityTransaction,
    profileVersionId: string,
  ): Promise<readonly QualityProfileReleaseRequirementTable[]> {
    return trx
      .selectFrom('quality_governance.quality_profile_release_requirement')
      .selectAll()
      .where('profile_version_id', '=', profileVersionId)
      .orderBy('requirement_order')
      .execute();
  }

  async getChangeImpactById(
    trx: QualityTransaction,
    changeImpactId: string,
  ): Promise<ChangeImpactTable | undefined> {
    return trx
      .selectFrom('quality_governance.change_impact')
      .selectAll()
      .where('change_impact_id', '=', changeImpactId)
      .executeTakeFirst();
  }

  async getGateResultById(
    trx: QualityTransaction,
    gateResultId: string,
  ): Promise<GateResultTable | undefined> {
    return trx
      .selectFrom('quality_governance.gate_result')
      .selectAll()
      .where('gate_result_id', '=', gateResultId)
      .executeTakeFirst();
  }

  async getGateResults(trx: QualityTransaction): Promise<readonly GateResultTable[]> {
    return trx
      .selectFrom('quality_governance.gate_result')
      .selectAll()
      .orderBy('completed_at', 'desc')
      .orderBy('gate_result_id', 'desc')
      .execute();
  }

  async getGateResultReuseByGateResultId(
    trx: QualityTransaction,
    gateResultId: string,
  ): Promise<GateResultReuseTable | undefined> {
    return trx
      .selectFrom('quality_governance.gate_result_reuse')
      .selectAll()
      .where('gate_result_id', '=', gateResultId)
      .executeTakeFirst();
  }

  async getGateInvalidationByGateResultId(
    trx: QualityTransaction,
    gateResultId: string,
  ): Promise<GateInvalidationTable | undefined> {
    return trx
      .selectFrom('quality_governance.gate_invalidation')
      .selectAll()
      .where('gate_result_id', '=', gateResultId)
      .executeTakeFirst();
  }

  async getRevisionAcceptanceSnapshotById(
    trx: QualityTransaction,
    snapshotId: string,
  ): Promise<RevisionAcceptanceSnapshotTable | undefined> {
    return trx
      .selectFrom('quality_governance.revision_acceptance_snapshot')
      .selectAll()
      .where('snapshot_id', '=', snapshotId)
      .executeTakeFirst();
  }

  async getReleaseReadinessSnapshotById(
    trx: QualityTransaction,
    snapshotId: string,
  ): Promise<ReleaseReadinessSnapshotTable | undefined> {
    return trx
      .selectFrom('quality_governance.release_readiness_snapshot')
      .selectAll()
      .where('snapshot_id', '=', snapshotId)
      .executeTakeFirst();
  }

  async getLatestReleaseReadinessSnapshot(
    trx: QualityTransaction,
    releaseRef: unknown,
  ): Promise<ReleaseReadinessSnapshotTable | undefined> {
    return trx
      .selectFrom('quality_governance.release_readiness_snapshot')
      .selectAll()
      .where(sql<boolean>`release_ref = ${json(releaseRef)}::jsonb`)
      .orderBy('evaluated_at', 'desc')
      .orderBy('snapshot_id', 'desc')
      .executeTakeFirst();
  }

  async getLatestRevisionAcceptanceSnapshot(
    trx: QualityTransaction,
    revisionRef: unknown,
    qualityProfileRef: unknown,
  ): Promise<RevisionAcceptanceSnapshotTable | undefined> {
    return trx
      .selectFrom('quality_governance.revision_acceptance_snapshot')
      .selectAll()
      .where(sql<boolean>`revision_ref = ${json(revisionRef)}::jsonb`)
      .where(sql<boolean>`quality_profile_ref = ${json(qualityProfileRef)}::jsonb`)
      .orderBy('evaluated_at', 'desc')
      .orderBy('snapshot_id', 'desc')
      .executeTakeFirst();
  }

  async getReviewIssueById(
    trx: QualityTransaction,
    reviewIssueId: string,
  ): Promise<ReviewIssueTable | undefined> {
    return trx
      .selectFrom('quality_governance.review_issue')
      .selectAll()
      .where('review_issue_id', '=', reviewIssueId)
      .executeTakeFirst();
  }

  async getReviewIssues(trx: QualityTransaction): Promise<readonly ReviewIssueTable[]> {
    return trx
      .selectFrom('quality_governance.review_issue')
      .selectAll()
      .orderBy('created_at', 'desc')
      .orderBy('review_issue_id', 'desc')
      .execute();
  }

  async getIssueObservations(
    trx: QualityTransaction,
    reviewIssueId: string,
  ): Promise<readonly IssueObservationTable[]> {
    return trx
      .selectFrom('quality_governance.issue_observation')
      .selectAll()
      .where('review_issue_id', '=', reviewIssueId)
      .orderBy('observed_at', 'desc')
      .execute();
  }

  async getResolutionProposals(
    trx: QualityTransaction,
    reviewIssueId: string,
  ): Promise<readonly ResolutionProposalTable[]> {
    return trx
      .selectFrom('quality_governance.resolution_proposal')
      .selectAll()
      .where('review_issue_id', '=', reviewIssueId)
      .orderBy('proposed_at', 'desc')
      .orderBy('resolution_id', 'desc')
      .execute();
  }

  async getVerificationRecords(
    trx: QualityTransaction,
    reviewIssueId: string,
  ): Promise<readonly VerificationRecordTable[]> {
    return trx
      .selectFrom('quality_governance.verification_record')
      .selectAll()
      .where('review_issue_id', '=', reviewIssueId)
      .orderBy('verified_at', 'desc')
      .orderBy('verification_id', 'desc')
      .execute();
  }

  async getVerificationRecordById(
    trx: QualityTransaction,
    verificationId: string,
  ): Promise<VerificationRecordTable | undefined> {
    return trx
      .selectFrom('quality_governance.verification_record')
      .selectAll()
      .where('verification_id', '=', verificationId)
      .executeTakeFirst();
  }

  async getIssueStateTransitions(
    trx: QualityTransaction,
    reviewIssueId: string,
  ): Promise<readonly IssueStateTransitionTable[]> {
    return trx
      .selectFrom('quality_governance.issue_state_transition')
      .selectAll()
      .where('review_issue_id', '=', reviewIssueId)
      .orderBy('transitioned_at', 'asc')
      .orderBy('transition_id', 'asc')
      .execute();
  }

  async getApprovalRequestById(
    trx: QualityTransaction,
    requestId: string,
  ): Promise<ApprovalRequestTable | undefined> {
    return trx
      .selectFrom('quality_governance.approval_request')
      .selectAll()
      .where('request_id', '=', requestId)
      .executeTakeFirst();
  }

  async getApprovalById(
    trx: QualityTransaction,
    approvalId: string,
  ): Promise<ApprovalTable | undefined> {
    return trx
      .selectFrom('quality_governance.approval')
      .selectAll()
      .where('approval_id', '=', approvalId)
      .executeTakeFirst();
  }

  async getApprovals(trx: QualityTransaction): Promise<readonly ApprovalTable[]> {
    return trx
      .selectFrom('quality_governance.approval')
      .selectAll()
      .orderBy('created_at', 'desc')
      .orderBy('approval_id', 'desc')
      .execute();
  }

  async getApprovalDecisions(
    trx: QualityTransaction,
    approvalId: string,
  ): Promise<readonly ApprovalDecisionTable[]> {
    return trx
      .selectFrom('quality_governance.approval_decision')
      .selectAll()
      .where('approval_id', '=', approvalId)
      .orderBy('decided_at', 'desc')
      .orderBy('decision_id', 'desc')
      .execute();
  }

  async getApprovalRevocations(
    trx: QualityTransaction,
    approvalId: string,
  ): Promise<readonly ApprovalRevocationTable[]> {
    return trx
      .selectFrom('quality_governance.approval_revocation')
      .selectAll()
      .where('approval_id', '=', approvalId)
      .orderBy('revoked_at', 'desc')
      .orderBy('revocation_id', 'desc')
      .execute();
  }

  async getApprovalBundleSnapshotById(
    trx: QualityTransaction,
    snapshotId: string,
  ): Promise<ApprovalBundleSnapshotTable | undefined> {
    return trx
      .selectFrom('quality_governance.approval_bundle_snapshot')
      .selectAll()
      .where('snapshot_id', '=', snapshotId)
      .executeTakeFirst();
  }

  async getLatestApprovalBundleSnapshot(
    trx: QualityTransaction,
    revisionRef: unknown,
    qualityProfileRef: unknown,
  ): Promise<ApprovalBundleSnapshotTable | undefined> {
    return trx
      .selectFrom('quality_governance.approval_bundle_snapshot')
      .selectAll()
      .where(sql<boolean>`revision_ref = ${json(revisionRef)}::jsonb`)
      .where(sql<boolean>`quality_profile_ref = ${json(qualityProfileRef)}::jsonb`)
      .orderBy('evaluated_at', 'desc')
      .orderBy('snapshot_id', 'desc')
      .executeTakeFirst();
  }

  async getApprovalBundleSnapshots(
    trx: QualityTransaction,
  ): Promise<readonly ApprovalBundleSnapshotTable[]> {
    return trx
      .selectFrom('quality_governance.approval_bundle_snapshot')
      .selectAll()
      .orderBy('evaluated_at', 'desc')
      .orderBy('snapshot_id', 'desc')
      .execute();
  }
}
