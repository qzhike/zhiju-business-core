// IM-05 WI-02 (issue #122): repository for the business write functions and
// exact RLS reads. Business INSERT/UPDATE statements are intentionally absent
// from this file; all mutations cross the owner-function boundary created by
// V5002.

import { sql } from 'kysely';
import type {
  EvidenceLinkTable,
  EvidenceRevocationTable,
  EvidenceTable,
  EvidenceValidationTable,
  QualityProfileApprovalRequirementTable,
  QualityProfileGateDependencyTable,
  QualityProfileGateSpecTable,
  QualityProfileReleaseRequirementTable,
  QualityProfileTable,
  QualityProfileVersionTable,
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
}
