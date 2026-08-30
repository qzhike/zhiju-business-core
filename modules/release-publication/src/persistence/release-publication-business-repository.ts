// IM-05 WI-06 (issue #126): Release/Package repository.
// Business INSERT/UPDATE statements are intentionally absent; all mutations
// cross the owner SECURITY DEFINER functions created by V6001.

import { sql } from 'kysely';
import type { Common, ReleasePublication } from '@zhiju/contracts';
import type {
  ReleaseDestinationTable,
  ReleasePackageItemTable,
  ReleasePackageTable,
  ReleaseRecordTable,
  ReleaseTransaction,
} from './release-publication-db.js';

function json(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string')
    throw new TypeError('business JSON value cannot be undefined');
  return serialized;
}

export type BusinessWriteOutcome =
  'OK' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID' | 'FROZEN' | 'MULTIPLE_HASH' | 'NOT_ALLOWED';

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
}

interface ReleaseWriteResultRow {
  readonly outcome?: BusinessWriteOutcome;
  readonly aggregate_version?: string | null;
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
