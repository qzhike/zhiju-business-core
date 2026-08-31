// IM-05 WI-06 (issue #126): Release/Package repository.
// Business INSERT/UPDATE statements are intentionally absent; all mutations
// cross the owner SECURITY DEFINER functions created by V6001/V6002.

import { sql } from 'kysely';
import type { Common, ReleasePublication } from '@zhiju/contracts';
import type {
  ReleaseDestinationTable,
  ReleasePackageItemTable,
  ReleasePackageTable,
  ReleaseRecordTable,
  PublicationAttemptTable,
  PublicationReceiptTable,
  ReleaseImpactReviewTable,
  ReleaseTransaction,
} from './release-publication-db.js';

function json(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string')
    throw new TypeError('business JSON value cannot be undefined');
  return serialized;
}

export type BusinessWriteOutcome =
  | 'OK'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID'
  | 'FROZEN'
  | 'MULTIPLE_HASH'
  | 'NOT_ALLOWED'
  | 'DUPLICATE';

export interface ReleaseWriteResult {
  readonly outcome: BusinessWriteOutcome;
  readonly aggregateVersion?: string;
}

export interface ReleaseDraftInsert {
  readonly releaseId: string;
  readonly enterpriseId: string;
  readonly projectId?: string;
  readonly artifactRef: Common.ObjectRef;
  readonly revisionRef: Common.ContentAddressedRef;
  readonly revisionContentHash: Buffer;
  readonly releaseNumber: string;
  readonly purpose: ReleasePublication.ReleasePurpose;
  readonly requestedEffectiveAt?: Date;
  readonly qualityProfileRef: Common.VersionedRef;
  readonly revisionAcceptanceSnapshotRef: Common.SnapshotRef;
  readonly approvalBundleSnapshotRef: Common.SnapshotRef;
  readonly supersedesReleaseRef?: Common.ObjectRef;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface ReleaseSelectionReplacement {
  readonly releaseId: string;
  readonly expectedVersion: string;
  readonly selections: readonly ReleasePublication.ReleaseRepresentationSelection[];
  readonly selectionReason: Common.Justification;
  readonly updatedByPrincipalId: string;
  readonly updatedByActorSnapshotId: string;
  readonly updatedAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface ReleaseDestinationReplacement {
  readonly releaseId: string;
  readonly expectedVersion: string;
  readonly destinations: readonly ReleasePublication.ReleaseDestinationDefinition[];
  readonly recipientScopeSnapshotRef: Common.SnapshotRef;
  readonly updatedByPrincipalId: string;
  readonly updatedByActorSnapshotId: string;
  readonly updatedAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface ReleasePrepareInput {
  readonly releaseId: string;
  readonly expectedVersion: string;
  readonly packageId: string;
  readonly packageHash: Buffer;
  readonly packagePayloadHash: Buffer;
  readonly packageDefinition: ReleasePublication.ReleasePackageDefinition;
  readonly canonicalManifest: unknown;
  readonly preparationValidationRef: Common.ContentAddressedRef;
  readonly preparedAt: Date;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface ReleaseCancelInput {
  readonly releaseId: string;
  readonly expectedVersion: string;
  readonly cancelReason: Common.Justification;
  readonly cancelledAt: Date;
  readonly updatedByPrincipalId: string;
  readonly updatedByActorSnapshotId: string;
  readonly updatedAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface ReleaseReadinessValidationInput {
  readonly releaseId: string;
  readonly expectedVersion: string;
  readonly releaseReadinessSnapshotRef: Common.SnapshotRef;
  readonly validatedPackageRef: Common.ReleasePackageRef;
  readonly validatedAt: Date;
  readonly updatedByPrincipalId: string;
  readonly updatedByActorSnapshotId: string;
  readonly updatedAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface ReleaseAuthorizationInput {
  readonly releaseId: string;
  readonly expectedVersion: string;
  readonly releaseReadinessSnapshotRef: Common.SnapshotRef;
  readonly authorizingHumanRef: Common.PrincipalRef;
  readonly actorSnapshotRef: Common.SnapshotRef;
  readonly authorizationDecisionRef: Common.ContentAddressedRef;
  readonly authorizationRef: Common.ContentAddressedRef;
  readonly authorizedAt: Date;
  readonly updatedByPrincipalId: string;
  readonly updatedByActorSnapshotId: string;
  readonly updatedAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface PublicationAttemptInsert {
  readonly attemptId: string;
  readonly releaseId: string;
  readonly packageId: string;
  readonly destinationId: string;
  readonly attemptNumber: number;
  readonly stableIdempotencyKey: string;
  readonly definition: ReleasePublication.PublicationAttemptDefinition;
  readonly requestedAt: Date;
  readonly externalDeliveryRequestRef: Common.ContentAddressedRef;
  readonly observationPayloadHash: Buffer;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface PublicationReceiptInsert {
  readonly receiptId: string;
  readonly attemptId: string;
  readonly releaseId: string;
  readonly packageId: string;
  readonly destinationId: string;
  readonly rawReceiptRef: Common.ContentAddressedRef;
  readonly formalReceiptRef: Common.ContentAddressedRef;
  readonly providerResult: unknown;
  readonly receiptPayloadHash: Buffer;
  readonly observationPayloadHash: Buffer;
  readonly occurredAt: Date;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface PublicationFailureInsert {
  readonly failureId: string;
  readonly failureRef: Common.ContentAddressedRef;
  readonly attemptId: string;
  readonly releaseId: string;
  readonly packageId: string;
  readonly destinationId: string;
  readonly classification: string;
  readonly retryable: boolean;
  readonly outcome: 'FAILED' | 'UNKNOWN';
  readonly providerRef?: Common.ExternalRef;
  readonly diagnosticRef?: Common.ExternalRef;
  readonly observationPayloadHash: Buffer;
  readonly occurredAt: Date;
  readonly createdByPrincipalId: string;
  readonly createdByActorSnapshotId: string;
  readonly createdAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface ReleaseCompletionInput {
  readonly releaseId: string;
  readonly expectedVersion: string;
  readonly completionPolicyRef: Common.VersionedRef;
  readonly destinationOutcomeRefs: readonly Common.TypedReference[];
  readonly evaluatedAt: Date;
  readonly updatedByPrincipalId: string;
  readonly updatedByActorSnapshotId: string;
  readonly updatedAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface ReleaseRecallInsert {
  readonly recallId: string;
  readonly recallRef: Common.ContentAddressedRef;
  readonly releaseId: string;
  readonly packageId: string;
  readonly recallScope: unknown;
  readonly recallReason: Common.Justification;
  readonly authorizingHumanRef: Common.PrincipalRef;
  readonly authorizationDecisionRef: Common.ContentAddressedRef;
  readonly notificationPolicyRef: Common.VersionedRef;
  readonly affectedDestinations: readonly string[];
  readonly recalledAt: Date;
  readonly payloadHash: Buffer;
  readonly updatedByPrincipalId: string;
  readonly updatedByActorSnapshotId: string;
  readonly updatedAuthorizationDecisionId: string;
  readonly sourceCommandId: string;
}

export interface ReleaseStatusWriteResult extends ReleaseWriteResult {
  readonly status?: ReleasePublication.ReleaseStatus;
}

export class ReleasePublicationBusinessRepository {
  async insertReleaseDraft(
    trx: ReleaseTransaction,
    input: ReleaseDraftInsert,
  ): Promise<ReleaseWriteResult> {
    const result = await sql<ReleaseWriteResultRow>`
      SELECT outcome, aggregate_version::text
      FROM release_publication.create_release_draft(
        ${input.releaseId}::uuid,
        ${input.enterpriseId}::uuid,
        ${input.projectId ?? null}::uuid,
        ${json(input.artifactRef)}::jsonb,
        ${json(input.revisionRef)}::jsonb,
        ${input.revisionContentHash}::bytea,
        ${input.releaseNumber},
        ${input.purpose},
        ${input.requestedEffectiveAt ?? null}::timestamptz,
        ${json(input.qualityProfileRef)}::jsonb,
        ${json(input.revisionAcceptanceSnapshotRef)}::jsonb,
        ${json(input.approvalBundleSnapshotRef)}::jsonb,
        ${input.supersedesReleaseRef === undefined ? null : json(input.supersedesReleaseRef)}::jsonb,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return writeResult(result.rows[0]);
  }

  async replaceReleaseSelections(
    trx: ReleaseTransaction,
    input: ReleaseSelectionReplacement,
  ): Promise<ReleaseWriteResult> {
    const result = await sql<ReleaseWriteResultRow>`
      SELECT outcome, aggregate_version::text
      FROM release_publication.replace_release_selections(
        ${input.releaseId}::uuid,
        ${input.expectedVersion}::bigint,
        ${json(input.selections)}::jsonb,
        ${json(input.selectionReason)}::jsonb,
        ${input.updatedByPrincipalId}::uuid,
        ${input.updatedByActorSnapshotId}::uuid,
        ${input.updatedAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return writeResult(result.rows[0]);
  }

  async replaceReleaseDestinations(
    trx: ReleaseTransaction,
    input: ReleaseDestinationReplacement,
  ): Promise<ReleaseWriteResult> {
    const result = await sql<ReleaseWriteResultRow>`
      SELECT outcome, aggregate_version::text
      FROM release_publication.replace_release_destinations(
        ${input.releaseId}::uuid,
        ${input.expectedVersion}::bigint,
        ${json(input.destinations)}::jsonb,
        ${json(input.recipientScopeSnapshotRef)}::jsonb,
        ${input.updatedByPrincipalId}::uuid,
        ${input.updatedByActorSnapshotId}::uuid,
        ${input.updatedAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return writeResult(result.rows[0]);
  }

  async prepareRelease(
    trx: ReleaseTransaction,
    input: ReleasePrepareInput,
  ): Promise<ReleaseWriteResult> {
    const result = await sql<ReleaseWriteResultRow>`
      SELECT outcome, aggregate_version::text
      FROM release_publication.prepare_release(
        ${input.releaseId}::uuid,
        ${input.expectedVersion}::bigint,
        ${input.packageId}::uuid,
        ${input.packageHash}::bytea,
        ${input.packagePayloadHash}::bytea,
        ${json(input.packageDefinition)}::jsonb,
        ${json(input.canonicalManifest)}::jsonb,
        ${json(input.preparationValidationRef)}::jsonb,
        ${json(input.packageDefinition.representations)}::jsonb,
        ${json(input.packageDefinition.destinations)}::jsonb,
        ${input.preparedAt}::timestamptz,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return writeResult(result.rows[0]);
  }

  async cancelRelease(
    trx: ReleaseTransaction,
    input: ReleaseCancelInput,
  ): Promise<ReleaseWriteResult> {
    const result = await sql<ReleaseWriteResultRow>`
      SELECT outcome, aggregate_version::text
      FROM release_publication.cancel_release(
        ${input.releaseId}::uuid,
        ${input.expectedVersion}::bigint,
        ${json(input.cancelReason)}::jsonb,
        ${input.cancelledAt}::timestamptz,
        ${input.updatedByPrincipalId}::uuid,
        ${input.updatedByActorSnapshotId}::uuid,
        ${input.updatedAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return writeResult(result.rows[0]);
  }

  async validateReleaseReadiness(
    trx: ReleaseTransaction,
    input: ReleaseReadinessValidationInput,
  ): Promise<ReleaseWriteResult> {
    const result = await sql<ReleaseWriteResultRow>`
      SELECT outcome, aggregate_version::text
      FROM release_publication.validate_release_readiness(
        ${input.releaseId}::uuid,
        ${input.expectedVersion}::bigint,
        ${json(input.releaseReadinessSnapshotRef)}::jsonb,
        ${json(input.validatedPackageRef)}::jsonb,
        ${input.validatedAt}::timestamptz,
        ${input.updatedByPrincipalId}::uuid,
        ${input.updatedByActorSnapshotId}::uuid,
        ${input.updatedAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return writeResult(result.rows[0]);
  }

  async authorizeRelease(
    trx: ReleaseTransaction,
    input: ReleaseAuthorizationInput,
  ): Promise<ReleaseStatusWriteResult> {
    const result = await sql<ReleaseWriteResultRow>`
      SELECT outcome, aggregate_version::text, status
      FROM release_publication.authorize_release(
        ${input.releaseId}::uuid,
        ${input.expectedVersion}::bigint,
        ${json(input.releaseReadinessSnapshotRef)}::jsonb,
        ${json(input.authorizingHumanRef)}::jsonb,
        ${json(input.actorSnapshotRef)}::jsonb,
        ${json(input.authorizationDecisionRef)}::jsonb,
        ${json(input.authorizationRef)}::jsonb,
        ${input.authorizedAt}::timestamptz,
        ${input.updatedByPrincipalId}::uuid,
        ${input.updatedByActorSnapshotId}::uuid,
        ${input.updatedAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return statusWriteResult(result.rows[0]);
  }

  async insertPublicationAttempt(
    trx: ReleaseTransaction,
    input: PublicationAttemptInsert,
  ): Promise<ReleaseWriteResult> {
    const result = await sql<ReleaseWriteResultRow>`
      SELECT outcome, aggregate_version::text
      FROM release_publication.create_publication_attempt(
        ${input.attemptId}::uuid,
        ${input.releaseId}::uuid,
        ${input.packageId}::uuid,
        ${input.destinationId}::uuid,
        ${input.attemptNumber}::integer,
        ${input.stableIdempotencyKey},
        ${json(input.definition)}::jsonb,
        ${input.requestedAt}::timestamptz,
        ${json(input.externalDeliveryRequestRef)}::jsonb,
        ${input.observationPayloadHash}::bytea,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return writeResult(result.rows[0]);
  }

  async recordPublicationReceipt(
    trx: ReleaseTransaction,
    input: PublicationReceiptInsert,
  ): Promise<ReleaseStatusWriteResult> {
    const result = await sql<ReleaseWriteResultRow>`
      SELECT outcome, aggregate_version::text, status
      FROM release_publication.record_publication_receipt(
        ${input.receiptId}::uuid,
        ${input.attemptId}::uuid,
        ${input.releaseId}::uuid,
        ${input.packageId}::uuid,
        ${input.destinationId}::uuid,
        ${json(input.rawReceiptRef)}::jsonb,
        ${json(input.formalReceiptRef)}::jsonb,
        ${json(input.providerResult)}::jsonb,
        ${input.receiptPayloadHash}::bytea,
        ${input.observationPayloadHash}::bytea,
        ${input.occurredAt}::timestamptz,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return statusWriteResult(result.rows[0]);
  }

  async recordPublicationFailure(
    trx: ReleaseTransaction,
    input: PublicationFailureInsert,
  ): Promise<ReleaseStatusWriteResult> {
    const result = await sql<ReleaseWriteResultRow>`
      SELECT outcome, aggregate_version::text, status
      FROM release_publication.record_publication_failure(
        ${input.failureId}::uuid,
        ${json(input.failureRef)}::jsonb,
        ${input.attemptId}::uuid,
        ${input.releaseId}::uuid,
        ${input.packageId}::uuid,
        ${input.destinationId}::uuid,
        ${input.classification},
        ${input.retryable},
        ${input.outcome},
        ${input.providerRef === undefined ? null : json(input.providerRef)}::jsonb,
        ${input.diagnosticRef === undefined ? null : json(input.diagnosticRef)}::jsonb,
        ${input.observationPayloadHash}::bytea,
        ${input.occurredAt}::timestamptz,
        ${input.createdByPrincipalId}::uuid,
        ${input.createdByActorSnapshotId}::uuid,
        ${input.createdAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return statusWriteResult(result.rows[0]);
  }

  async completeRelease(
    trx: ReleaseTransaction,
    input: ReleaseCompletionInput,
  ): Promise<ReleaseStatusWriteResult> {
    const result = await sql<ReleaseWriteResultRow>`
      SELECT outcome, aggregate_version::text, status
      FROM release_publication.complete_release(
        ${input.releaseId}::uuid,
        ${input.expectedVersion}::bigint,
        ${json(input.completionPolicyRef)}::jsonb,
        ${json(input.destinationOutcomeRefs)}::jsonb,
        ${input.evaluatedAt}::timestamptz,
        ${input.updatedByPrincipalId}::uuid,
        ${input.updatedByActorSnapshotId}::uuid,
        ${input.updatedAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return statusWriteResult(result.rows[0]);
  }

  async recallRelease(
    trx: ReleaseTransaction,
    input: ReleaseRecallInsert,
  ): Promise<ReleaseStatusWriteResult> {
    const result = await sql<ReleaseWriteResultRow>`
      SELECT outcome, aggregate_version::text, status
      FROM release_publication.recall_release(
        ${input.recallId}::uuid,
        ${json(input.recallRef)}::jsonb,
        ${input.releaseId}::uuid,
        ${input.packageId}::uuid,
        ${json(input.recallScope)}::jsonb,
        ${json(input.recallReason)}::jsonb,
        ${json(input.authorizingHumanRef)}::jsonb,
        ${json(input.authorizationDecisionRef)}::jsonb,
        ${json(input.notificationPolicyRef)}::jsonb,
        ${json(input.affectedDestinations)}::jsonb,
        ${input.recalledAt}::timestamptz,
        ${input.payloadHash}::bytea,
        ${input.updatedByPrincipalId}::uuid,
        ${input.updatedByActorSnapshotId}::uuid,
        ${input.updatedAuthorizationDecisionId}::uuid,
        ${input.sourceCommandId}::uuid
      )
    `.execute(trx);
    return statusWriteResult(result.rows[0]);
  }

  async getReleaseById(
    trx: ReleaseTransaction,
    releaseId: string,
  ): Promise<ReleaseRecordTable | undefined> {
    return trx
      .selectFrom('release_publication.release_record')
      .selectAll()
      .where('release_id', '=', releaseId)
      .executeTakeFirst();
  }

  async getPackageById(
    trx: ReleaseTransaction,
    packageId: string,
  ): Promise<ReleasePackageTable | undefined> {
    return trx
      .selectFrom('release_publication.release_package')
      .selectAll()
      .where('package_id', '=', packageId)
      .executeTakeFirst();
  }

  async getPackageByReleaseId(
    trx: ReleaseTransaction,
    releaseId: string,
  ): Promise<ReleasePackageTable | undefined> {
    return trx
      .selectFrom('release_publication.release_package')
      .selectAll()
      .where('release_id', '=', releaseId)
      .executeTakeFirst();
  }

  async getPackageItems(
    trx: ReleaseTransaction,
    packageId: string,
  ): Promise<readonly ReleasePackageItemTable[]> {
    return trx
      .selectFrom('release_publication.release_package_item')
      .selectAll()
      .where('package_id', '=', packageId)
      .orderBy('ordinal', 'asc')
      .execute();
  }

  async getPackageDestinations(
    trx: ReleaseTransaction,
    packageId: string,
  ): Promise<readonly ReleaseDestinationTable[]> {
    return trx
      .selectFrom('release_publication.release_destination')
      .selectAll()
      .where('package_id', '=', packageId)
      .orderBy('destination_id', 'asc')
      .execute();
  }

  async getPublicationAttempts(
    trx: ReleaseTransaction,
    releaseId: string,
  ): Promise<readonly PublicationAttemptTable[]> {
    return (await trx
      .selectFrom('release_publication.publication_attempt')
      .selectAll()
      .where('release_id', '=', releaseId)
      .orderBy('destination_id', 'asc')
      .orderBy('attempt_number', 'asc')
      .execute()) as unknown as readonly PublicationAttemptTable[];
  }

  async getPublicationReceipts(
    trx: ReleaseTransaction,
    releaseId: string,
  ): Promise<readonly PublicationReceiptTable[]> {
    return (await trx
      .selectFrom('release_publication.publication_receipt')
      .selectAll()
      .where('release_id', '=', releaseId)
      .orderBy('destination_id', 'asc')
      .execute()) as unknown as readonly PublicationReceiptTable[];
  }

  async getReleaseImpact(
    trx: ReleaseTransaction,
    releaseId: string,
  ): Promise<readonly ReleaseImpactReviewTable[]> {
    return (await trx
      .selectFrom('release_publication.release_impact_review')
      .selectAll()
      .where('release_id', '=', releaseId)
      .orderBy('created_at', 'desc')
      .execute()) as unknown as readonly ReleaseImpactReviewTable[];
  }
}

interface ReleaseWriteResultRow {
  readonly outcome?: BusinessWriteOutcome;
  readonly aggregate_version?: string | null;
  readonly status?: ReleasePublication.ReleaseStatus | null;
}

function writeResult(row: ReleaseWriteResultRow | undefined): ReleaseWriteResult {
  if (row?.outcome === undefined) return { outcome: 'INVALID' };
  return {
    outcome: row.outcome,
    ...(row.aggregate_version === null || row.aggregate_version === undefined
      ? {}
      : { aggregateVersion: row.aggregate_version }),
  };
}

function statusWriteResult(row: ReleaseWriteResultRow | undefined): ReleaseStatusWriteResult {
  const base = writeResult(row);
  return {
    ...base,
    ...(row?.status === null || row?.status === undefined ? {} : { status: row.status }),
  };
}
