// IM-04 WI-02/WI-05 (issues #91/#94): repository for Artifact technical facts,
// business Root/Branch facts and immutable Revision boundaries.
// and the Root/Branch business write boundary. Cross-schema reads remain
// deliberately outside this repository.

import { sql } from 'kysely';
import type { ArtifactTransaction } from './artifact-db.js';
import type {
  ArtifactBranchTable,
  ArtifactContentObjectLinkTable,
  ArtifactContentObjectTable,
  ArtifactRevisionTable,
  RevisionInvalidationTable,
  RevisionParentTable,
  RevisionWithdrawalTable,
  ArtifactTable,
} from './artifact-business-types.js';
import {
  ArtifactPersistenceError,
  ARTIFACT_CONTEXT_PRINCIPAL_MISMATCH,
  ARTIFACT_CONTEXT_SCOPE_MISMATCH,
} from './write-guards.js';

export interface ProcessInstanceInsert {
  processId: string;
  processType: string;
  processVersion: string;
  correlationKey: string;
  enterpriseId: string;
  projectId?: string | undefined;
  state?: 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'SUSPENDED';
  createdByPrincipalId: string;
}

export interface ArtifactInsert {
  artifactId: string;
  defaultBranchId: string;
  enterpriseId: string;
  projectId?: string | undefined;
  businessScope: 'PROJECT_DELIVERABLE' | 'ENTERPRISE_CONTROLLED';
  originProjectRef?: unknown;
  artifactType: string;
  title: string;
  classification: string;
  identityHash: Buffer;
  deliveryItemRefs: unknown;
  metadata: unknown;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  createdAuthorizationDecisionId: string;
  sourceCommandId: string;
}

export interface ArtifactMetadataCas {
  artifactId: string;
  expectedVersion: string;
  title: string;
  classification: string;
  metadata: unknown;
  updatedByPrincipalId: string;
  updatedByActorSnapshotId: string;
  lastAuthorizationDecisionId: string;
  sourceCommandId: string;
}

export interface ArtifactArchiveCas {
  artifactId: string;
  expectedVersion: string;
  archivedAt: Date;
  archiveReason: unknown;
  retentionPolicyRef: unknown;
  updatedByPrincipalId: string;
  updatedByActorSnapshotId: string;
  lastAuthorizationDecisionId: string;
  sourceCommandId: string;
}

export type ArtifactCasOutcome = 'OK' | 'NOT_FOUND' | 'CONFLICT' | 'NOT_ACTIVE';

export interface ArtifactRevisionInsert {
  revisionId: string;
  artifactId: string;
  branchId: string;
  enterpriseId: string;
  projectId?: string | undefined;
  revisionKind: 'INITIAL' | 'ORDINARY' | 'MERGE';
  contentObjectId: string;
  contentType: 'STRUCTURED_DOCUMENT' | 'WORKBOOK_SPEC';
  objectLocator: string;
  contentHash: Buffer;
  structureSchemaRef: unknown;
  canonicalizationVersion: string;
  byteSize: number;
  mediaType: string;
  semanticMetadata: unknown;
  changedUnits: unknown;
  changeSummary: string;
  provenance: unknown;
  parentRefs: unknown;
  mergeStrategy?: string | undefined;
  conflictSet?: unknown;
  conflictResolutionRefs?: unknown;
  resolvedByRef?: unknown;
  conflictId?: string | undefined;
  conflictHash?: Buffer | undefined;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  createdAuthorizationDecisionId: string;
  sourceCommandId: string;
}

export type ArtifactRevisionCreateOutcome =
  | 'OK'
  | 'NOT_FOUND'
  | 'NOT_ACTIVE'
  | 'CONFLICT'
  | 'CONTENT_NOT_FROZEN'
  | 'CONTENT_HASH_MISMATCH'
  | 'CONTENT_LINK_CONFLICT'
  | 'PARENT_INVALID'
  | 'PARENT_REQUIRED'
  | 'PARENT_DUPLICATE'
  | 'CROSS_ARTIFACT_PARENT'
  | 'LINEAGE_CYCLE'
  | 'CONFLICT_INVALID'
  | 'CONTEXT_REJECTED';

export interface ArtifactHeadMove {
  artifactId: string;
  branchId: string;
  expectedVersion: string;
  expectedHeadRef?: unknown;
  newHeadRef: unknown;
  enterpriseId: string;
  projectId?: string | undefined;
  conflictId: string;
  conflictPayload: unknown;
  conflictHash: Buffer;
  updatedByPrincipalId: string;
  updatedByActorSnapshotId: string;
  lastAuthorizationDecisionId: string;
  sourceCommandId: string;
}

export type ArtifactHeadMoveOutcome =
  'OK' | 'NOT_FOUND' | 'NOT_ACTIVE' | 'CONFLICT' | 'INVALID_REF' | 'ALREADY';

export interface RevisionGovernanceFact {
  factId: string;
  revisionId: string;
  artifactId: string;
  enterpriseId: string;
  projectId?: string | undefined;
  revisionRef: unknown;
  revisionHash: Buffer;
  reason: unknown;
  impactAssessmentRef?: unknown;
  occurredAt: Date;
  recordedByPrincipalId: string;
  recordedByActorSnapshotId: string;
  recordedAuthorizationDecisionId: string;
  sourceCommandId: string;
}

export type RevisionGovernanceOutcome = 'OK' | 'NOT_FOUND' | 'ALREADY';

export interface RevisionGovernanceState {
  readonly withdrawal: RevisionWithdrawalTable | undefined;
  readonly invalidation: RevisionInvalidationTable | undefined;
}

export interface RevisionGraph {
  readonly revisions: readonly ArtifactRevisionTable[];
  readonly parents: readonly RevisionParentTable[];
}

export interface ContentObjectInsert {
  contentObjectId: string;
  enterpriseId: string;
  projectId?: string | undefined;
  payloadSchemaRef: unknown;
  contentType: 'STRUCTURED_DOCUMENT' | 'WORKBOOK_SPEC';
  canonicalizationVersion: string;
  contentHash: Buffer;
  byteSize: number;
  mediaType: string;
  storageProvider: string;
  objectLocator: string;
  objectVersionId: string;
  verifiedAt: Date;
  retentionClass: string;
  retentionUntil?: Date | undefined;
  legalHold: boolean;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  createdAuthorizationDecisionId: string;
  sourceCommandId: string;
}

export type ContentObjectLinkOutcome =
  'OK' | 'NOT_FOUND' | 'CONFLICT' | 'ALREADY_LINKED' | 'OWNER_TYPE_INVALID' | 'INVALID_STATE';

export interface ContentObjectLinkInput {
  contentObjectId: string;
  expectedVersion: string;
  ownerObjectType: string;
  ownerObjectId: string;
  ownerVersionId: string;
  ownerPayloadHash?: Buffer | undefined;
  enterpriseId: string;
  projectId?: string | undefined;
  updatedByPrincipalId: string;
  updatedByActorSnapshotId: string;
  lastAuthorizationDecisionId: string;
  sourceCommandId: string;
}

export type ContentObjectFinalizationOutcome =
  'FINALIZED' | 'UNKNOWN' | 'ALREADY_FINALIZED' | 'NOT_FOUND' | 'QUARANTINED' | 'INVALID_STATE';

export interface ContentObjectFinalizationInput {
  contentObjectId: string;
  finalized: boolean;
  errorCode?: string | undefined;
  updatedByPrincipalId: string;
  updatedByActorSnapshotId: string;
  lastAuthorizationDecisionId: string;
  sourceCommandId: string;
}

export type ContentObjectStateOutcome =
  | 'OK'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'ALREADY_FROZEN'
  | 'NOT_FINALIZED'
  | 'QUARANTINED'
  | 'INVALID_STATE'
  | 'ALREADY_QUARANTINED';

export interface ContentObjectQuarantineInput {
  contentObjectId: string;
  expectedVersion: string;
  reasonCode: string;
  safeSummary: string;
  updatedByPrincipalId: string;
  updatedByActorSnapshotId: string;
  lastAuthorizationDecisionId: string;
  sourceCommandId: string;
}

export interface ContentObjectOrphanInsert {
  orphanId: string;
  contentObjectId: string;
  enterpriseId: string;
  projectId?: string | undefined;
  contentHash: Buffer;
  byteSize: number;
  mediaType: string;
  storageProvider: string;
  objectLocator: string;
  objectVersionId: string;
  storageState: 'STAGING' | 'QUARANTINED';
  retentionClass: string;
  retentionUntil?: Date | undefined;
  legalHold: boolean;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  createdAuthorizationDecisionId: string;
  sourceCommandId?: string | undefined;
}

export interface ContentObjectOrphanClaim {
  orphan_id: string;
  content_object_id: string;
  enterprise_id: string;
  project_id: string | null;
  content_hash: Buffer;
  byte_size: number;
  media_type: string;
  storage_provider: string;
  object_locator: string;
  object_version_id: string;
  storage_state: 'STAGING' | 'QUARANTINED';
  retention_class: string;
  retention_until: Date | null;
  legal_hold: boolean;
  attempt_count: number;
  source_command_id: string | null;
}

export type ContentObjectOrphanCompletion =
  'DELETED' | 'NOT_FOUND' | 'UNKNOWN' | 'RETRY' | 'HELD' | 'FENCED' | 'ALREADY_COMPLETED';

export interface ContentAuditInsert {
  auditId: string;
  enterpriseId: string;
  projectId?: string | undefined;
  principalId: string;
  actorSnapshotId: string;
  authorizationDecisionId: string;
  commandId?: string | undefined;
  commandType: string;
  outcome: 'ALLOWED' | 'DENIED' | 'COMMITTED' | 'REJECTED' | 'INFO';
  errorCode?: string | undefined;
  targetType?: string | undefined;
  targetId?: string | undefined;
  correlationId: string;
  safeSummary: string;
  sourceRequestHash?: Buffer | undefined;
}

export class ArtifactRepository {
  async insertArtifact(trx: ArtifactTransaction, insert: ArtifactInsert): Promise<boolean> {
    const result = await sql<{ created: boolean }>`
      SELECT artifact.create_artifact(
        CAST(${insert.artifactId} AS uuid),
        CAST(${insert.defaultBranchId} AS uuid),
        CAST(${insert.enterpriseId} AS uuid),
        CAST(${insert.projectId ?? null} AS uuid),
        ${insert.businessScope},
        CAST(${insert.originProjectRef === undefined ? null : JSON.stringify(insert.originProjectRef)} AS jsonb),
        ${insert.artifactType},
        ${insert.title},
        ${insert.classification},
        CAST(${insert.identityHash} AS bytea),
        CAST(${JSON.stringify(insert.deliveryItemRefs)} AS jsonb),
        CAST(${JSON.stringify(insert.metadata)} AS jsonb),
        CAST(${insert.createdByPrincipalId} AS uuid),
        CAST(${insert.createdByActorSnapshotId} AS uuid),
        CAST(${insert.createdAuthorizationDecisionId} AS uuid),
        CAST(${insert.sourceCommandId} AS uuid)
      ) AS created
    `.execute(trx);
    return result.rows[0]?.created === true;
  }

  async getArtifactById(
    trx: ArtifactTransaction,
    artifactId: string,
  ): Promise<ArtifactTable | undefined> {
    return (await trx
      .selectFrom('artifact.artifact')
      .selectAll()
      .where('artifact_id', '=', artifactId)
      .executeTakeFirst()) as unknown as ArtifactTable | undefined;
  }

  async getArtifactBranches(
    trx: ArtifactTransaction,
    artifactId: string,
  ): Promise<ArtifactBranchTable[]> {
    return (await trx
      .selectFrom('artifact.artifact_branch')
      .selectAll()
      .where('artifact_id', '=', artifactId)
      .orderBy('branch_name', 'asc')
      .execute()) as unknown as ArtifactBranchTable[];
  }

  async getArtifactBranchById(
    trx: ArtifactTransaction,
    branchId: string,
  ): Promise<ArtifactBranchTable | undefined> {
    return (await trx
      .selectFrom('artifact.artifact_branch')
      .selectAll()
      .where('branch_id', '=', branchId)
      .executeTakeFirst()) as unknown as ArtifactBranchTable | undefined;
  }

  async casArtifactMetadata(
    trx: ArtifactTransaction,
    input: ArtifactMetadataCas,
  ): Promise<ArtifactCasOutcome> {
    const result = await sql<{ outcome: ArtifactCasOutcome }>`
      SELECT artifact.cas_artifact_metadata(
        CAST(${input.artifactId} AS uuid),
        CAST(${input.expectedVersion} AS bigint),
        ${input.title},
        ${input.classification},
        CAST(${JSON.stringify(input.metadata)} AS jsonb),
        CAST(${input.updatedByPrincipalId} AS uuid),
        CAST(${input.updatedByActorSnapshotId} AS uuid),
        CAST(${input.lastAuthorizationDecisionId} AS uuid),
        CAST(${input.sourceCommandId} AS uuid)
      ) AS outcome
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'NOT_FOUND';
  }

  async archiveArtifact(
    trx: ArtifactTransaction,
    input: ArtifactArchiveCas,
  ): Promise<ArtifactCasOutcome> {
    const result = await sql<{ outcome: ArtifactCasOutcome }>`
      SELECT artifact.archive_artifact(
        CAST(${input.artifactId} AS uuid),
        CAST(${input.expectedVersion} AS bigint),
        CAST(${input.archivedAt} AS timestamptz),
        CAST(${JSON.stringify(input.archiveReason)} AS jsonb),
        CAST(${JSON.stringify(input.retentionPolicyRef)} AS jsonb),
        CAST(${input.updatedByPrincipalId} AS uuid),
        CAST(${input.updatedByActorSnapshotId} AS uuid),
        CAST(${input.lastAuthorizationDecisionId} AS uuid),
        CAST(${input.sourceCommandId} AS uuid)
      ) AS outcome
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'NOT_FOUND';
  }

  async createArtifactRevision(
    trx: ArtifactTransaction,
    input: ArtifactRevisionInsert,
  ): Promise<{ readonly outcome: ArtifactRevisionCreateOutcome; readonly revisionNo?: string }> {
    const result = await sql<{
      outcome: ArtifactRevisionCreateOutcome;
      revision_no: string | null;
    }>`
      SELECT * FROM artifact.create_artifact_revision(
        CAST(${input.revisionId} AS uuid),
        CAST(${input.artifactId} AS uuid),
        CAST(${input.branchId} AS uuid),
        CAST(${input.enterpriseId} AS uuid),
        CAST(${input.projectId ?? null} AS uuid),
        ${input.revisionKind},
        CAST(${input.contentObjectId} AS uuid),
        ${input.contentType},
        ${input.objectLocator},
        CAST(${input.contentHash} AS bytea),
        CAST(${JSON.stringify(input.structureSchemaRef)} AS jsonb),
        ${input.canonicalizationVersion},
        CAST(${input.byteSize} AS bigint),
        ${input.mediaType},
        CAST(${JSON.stringify(input.semanticMetadata)} AS jsonb),
        CAST(${JSON.stringify(input.changedUnits)} AS jsonb),
        ${input.changeSummary},
        CAST(${JSON.stringify(input.provenance)} AS jsonb),
        CAST(${JSON.stringify(input.parentRefs)} AS jsonb),
        ${input.mergeStrategy ?? null},
        CAST(${JSON.stringify(input.conflictSet ?? [])} AS jsonb),
        CAST(${JSON.stringify(input.conflictResolutionRefs ?? [])} AS jsonb),
        CAST(${input.resolvedByRef === undefined ? null : JSON.stringify(input.resolvedByRef)} AS jsonb),
        CAST(${input.conflictId ?? null} AS uuid),
        CAST(${input.conflictHash ?? null} AS bytea),
        CAST(${input.createdByPrincipalId} AS uuid),
        CAST(${input.createdByActorSnapshotId} AS uuid),
        CAST(${input.createdAuthorizationDecisionId} AS uuid),
        CAST(${input.sourceCommandId} AS uuid)
      )
    `.execute(trx);
    const row = result.rows[0];
    if (row === undefined) return { outcome: 'NOT_FOUND' };
    return {
      outcome: row.outcome,
      ...(row.revision_no === null ? {} : { revisionNo: row.revision_no }),
    };
  }

  async getRevisionById(
    trx: ArtifactTransaction,
    revisionId: string,
  ): Promise<ArtifactRevisionTable | undefined> {
    return (await trx
      .selectFrom('artifact.artifact_revision')
      .selectAll()
      .where('revision_id', '=', revisionId)
      .executeTakeFirst()) as unknown as ArtifactRevisionTable | undefined;
  }

  async getRevisionParents(
    trx: ArtifactTransaction,
    childRevisionId: string,
  ): Promise<RevisionParentTable[]> {
    return (await trx
      .selectFrom('artifact.revision_parent')
      .selectAll()
      .where('child_revision_id', '=', childRevisionId)
      .orderBy('parent_order', 'asc')
      .execute()) as unknown as RevisionParentTable[];
  }

  async getRevisionGovernance(
    trx: ArtifactTransaction,
    revisionId: string,
  ): Promise<RevisionGovernanceState> {
    const [withdrawal, invalidation] = await Promise.all([
      trx
        .selectFrom('artifact.revision_withdrawal')
        .selectAll()
        .where('revision_id', '=', revisionId)
        .executeTakeFirst(),
      trx
        .selectFrom('artifact.revision_invalidation')
        .selectAll()
        .where('revision_id', '=', revisionId)
        .executeTakeFirst(),
    ]);
    return {
      withdrawal: withdrawal as unknown as RevisionWithdrawalTable | undefined,
      invalidation: invalidation as unknown as RevisionInvalidationTable | undefined,
    };
  }

  async moveWorkingHead(
    trx: ArtifactTransaction,
    input: ArtifactHeadMove,
  ): Promise<ArtifactHeadMoveOutcome> {
    const result = await sql<{ outcome: ArtifactHeadMoveOutcome }>`
      SELECT artifact.move_working_head(
        CAST(${input.artifactId} AS uuid),
        CAST(${input.branchId} AS uuid),
        CAST(${input.expectedVersion} AS bigint),
        CAST(${input.expectedHeadRef === undefined ? null : JSON.stringify(input.expectedHeadRef)} AS jsonb),
        CAST(${JSON.stringify(input.newHeadRef)} AS jsonb),
        CAST(${input.enterpriseId} AS uuid),
        CAST(${input.projectId ?? null} AS uuid),
        CAST(${input.conflictId} AS uuid),
        CAST(${JSON.stringify(input.conflictPayload)} AS jsonb),
        CAST(${input.conflictHash} AS bytea),
        CAST(${input.updatedByPrincipalId} AS uuid),
        CAST(${input.updatedByActorSnapshotId} AS uuid),
        CAST(${input.lastAuthorizationDecisionId} AS uuid),
        CAST(${input.sourceCommandId} AS uuid)
      ) AS outcome
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'NOT_FOUND';
  }

  async withdrawRevision(
    trx: ArtifactTransaction,
    input: RevisionGovernanceFact,
  ): Promise<RevisionGovernanceOutcome> {
    const result = await sql<{ outcome: RevisionGovernanceOutcome }>`
      SELECT artifact.withdraw_revision(
        CAST(${input.factId} AS uuid),
        CAST(${input.revisionId} AS uuid),
        CAST(${input.artifactId} AS uuid),
        CAST(${input.enterpriseId} AS uuid),
        CAST(${input.projectId ?? null} AS uuid),
        CAST(${JSON.stringify(input.revisionRef)} AS jsonb),
        CAST(${input.revisionHash} AS bytea),
        CAST(${JSON.stringify(input.reason)} AS jsonb),
        CAST(${input.impactAssessmentRef === undefined ? null : JSON.stringify(input.impactAssessmentRef)} AS jsonb),
        CAST(${input.occurredAt} AS timestamptz),
        CAST(${input.recordedByPrincipalId} AS uuid),
        CAST(${input.recordedByActorSnapshotId} AS uuid),
        CAST(${input.recordedAuthorizationDecisionId} AS uuid),
        CAST(${input.sourceCommandId} AS uuid)
      ) AS outcome
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'NOT_FOUND';
  }

  async invalidateRevision(
    trx: ArtifactTransaction,
    input: RevisionGovernanceFact & { readonly impactAssessmentRef: unknown },
  ): Promise<RevisionGovernanceOutcome> {
    const result = await sql<{ outcome: RevisionGovernanceOutcome }>`
      SELECT artifact.invalidate_revision(
        CAST(${input.factId} AS uuid),
        CAST(${input.revisionId} AS uuid),
        CAST(${input.artifactId} AS uuid),
        CAST(${input.enterpriseId} AS uuid),
        CAST(${input.projectId ?? null} AS uuid),
        CAST(${JSON.stringify(input.revisionRef)} AS jsonb),
        CAST(${input.revisionHash} AS bytea),
        CAST(${JSON.stringify(input.reason)} AS jsonb),
        CAST(${JSON.stringify(input.impactAssessmentRef)} AS jsonb),
        CAST(${input.occurredAt} AS timestamptz),
        CAST(${input.recordedByPrincipalId} AS uuid),
        CAST(${input.recordedByActorSnapshotId} AS uuid),
        CAST(${input.recordedAuthorizationDecisionId} AS uuid),
        CAST(${input.sourceCommandId} AS uuid)
      ) AS outcome
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'NOT_FOUND';
  }

  async getRevisionGraph(
    trx: ArtifactTransaction,
    artifactId: string,
    headRevisionId: string | undefined,
    maxDepth: number,
  ): Promise<RevisionGraph> {
    const revisions =
      headRevisionId === undefined
        ? await trx
            .selectFrom('artifact.artifact_revision')
            .selectAll()
            .where('artifact_id', '=', artifactId)
            .orderBy('revision_no', 'asc')
            .execute()
        : await sql<ArtifactRevisionTable>`
            WITH RECURSIVE visible(revision_id, depth) AS (
                SELECT r.revision_id, 0
                  FROM artifact.artifact_revision r
                 WHERE r.artifact_id = CAST(${artifactId} AS uuid)
                   AND r.revision_id = CAST(${headRevisionId} AS uuid)
                UNION
                SELECT rp.parent_revision_id, visible.depth + 1
                  FROM visible
                  JOIN artifact.revision_parent rp
                    ON rp.child_revision_id = visible.revision_id
                 WHERE visible.depth < ${maxDepth}
            )
            SELECT r.*
              FROM artifact.artifact_revision r
              JOIN visible ON visible.revision_id = r.revision_id
             WHERE r.artifact_id = CAST(${artifactId} AS uuid)
             ORDER BY r.revision_no ASC
          `
            .execute(trx)
            .then((result) => result.rows);
    const parents = (await trx
      .selectFrom('artifact.revision_parent')
      .selectAll()
      .where('artifact_id', '=', artifactId)
      .orderBy('child_revision_id', 'asc')
      .orderBy('parent_order', 'asc')
      .execute()) as unknown as RevisionParentTable[];
    return {
      revisions: revisions as unknown as ArtifactRevisionTable[],
      parents,
    };
  }

  async insertContentObject(
    trx: ArtifactTransaction,
    insert: ContentObjectInsert,
  ): Promise<boolean> {
    const result = await sql<{ created: boolean }>`
      SELECT artifact.create_content_object(
        CAST(${insert.contentObjectId} AS uuid),
        CAST(${insert.enterpriseId} AS uuid),
        CAST(${insert.projectId ?? null} AS uuid),
        CAST(${JSON.stringify(insert.payloadSchemaRef)} AS jsonb),
        ${insert.contentType},
        ${insert.canonicalizationVersion},
        CAST(${insert.contentHash} AS bytea),
        CAST(${insert.byteSize} AS bigint),
        ${insert.mediaType},
        ${insert.storageProvider},
        ${insert.objectLocator},
        ${insert.objectVersionId},
        CAST(${insert.verifiedAt} AS timestamptz),
        ${insert.retentionClass},
        CAST(${insert.retentionUntil ?? null} AS timestamptz),
        ${insert.legalHold},
        CAST(${insert.createdByPrincipalId} AS uuid),
        CAST(${insert.createdByActorSnapshotId} AS uuid),
        CAST(${insert.createdAuthorizationDecisionId} AS uuid),
        CAST(${insert.sourceCommandId} AS uuid)
      ) AS created
    `.execute(trx);
    return result.rows[0]?.created === true;
  }

  async getContentObjectById(
    trx: ArtifactTransaction,
    contentObjectId: string,
  ): Promise<ArtifactContentObjectTable | undefined> {
    return (await trx
      .selectFrom('artifact.artifact_content_object')
      .selectAll()
      .where('content_object_id', '=', contentObjectId)
      .executeTakeFirst()) as unknown as ArtifactContentObjectTable | undefined;
  }

  async getFrozenContentObjectByIdentity(
    trx: ArtifactTransaction,
    input: {
      readonly enterpriseId: string;
      readonly projectId?: string | undefined;
      readonly contentType: 'STRUCTURED_DOCUMENT' | 'WORKBOOK_SPEC';
      readonly objectLocator: string;
      readonly contentHash: Buffer;
    },
  ): Promise<ArtifactContentObjectTable | undefined> {
    return (await trx
      .selectFrom('artifact.artifact_content_object')
      .selectAll()
      .where('enterprise_id', '=', input.enterpriseId)
      .where('project_id', '=', input.projectId ?? null)
      .where('content_type', '=', input.contentType)
      .where('object_locator', '=', input.objectLocator)
      .where('content_hash', '=', input.contentHash)
      .where('storage_state', '=', 'FROZEN')
      .executeTakeFirst()) as unknown as ArtifactContentObjectTable | undefined;
  }

  async getContentObjectLinkById(
    trx: ArtifactTransaction,
    contentObjectId: string,
  ): Promise<ArtifactContentObjectLinkTable | undefined> {
    return (await trx
      .selectFrom('artifact.artifact_content_object_link')
      .selectAll()
      .where('content_object_id', '=', contentObjectId)
      .executeTakeFirst()) as unknown as ArtifactContentObjectLinkTable | undefined;
  }

  async linkContentObject(
    trx: ArtifactTransaction,
    input: ContentObjectLinkInput,
  ): Promise<ContentObjectLinkOutcome> {
    const result = await sql<{ outcome: ContentObjectLinkOutcome }>`
      SELECT artifact.link_content_object(
        CAST(${input.contentObjectId} AS uuid),
        CAST(${input.expectedVersion} AS bigint),
        ${input.ownerObjectType},
        CAST(${input.ownerObjectId} AS uuid),
        CAST(${input.ownerVersionId} AS uuid),
        CAST(${input.ownerPayloadHash ?? null} AS bytea),
        CAST(${input.enterpriseId} AS uuid),
        CAST(${input.projectId ?? null} AS uuid),
        CAST(${input.updatedByPrincipalId} AS uuid),
        CAST(${input.updatedByActorSnapshotId} AS uuid),
        CAST(${input.lastAuthorizationDecisionId} AS uuid),
        CAST(${input.sourceCommandId} AS uuid)
      ) AS outcome
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'NOT_FOUND';
  }

  async markContentObjectFinalization(
    trx: ArtifactTransaction,
    input: ContentObjectFinalizationInput,
  ): Promise<ContentObjectFinalizationOutcome> {
    const result = await sql<{ outcome: ContentObjectFinalizationOutcome }>`
      SELECT artifact.mark_content_object_finalization(
        CAST(${input.contentObjectId} AS uuid),
        ${input.finalized},
        ${input.errorCode ?? null},
        CAST(${input.updatedByPrincipalId} AS uuid),
        CAST(${input.updatedByActorSnapshotId} AS uuid),
        CAST(${input.lastAuthorizationDecisionId} AS uuid),
        CAST(${input.sourceCommandId} AS uuid)
      ) AS outcome
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'NOT_FOUND';
  }

  async freezeContentObject(
    trx: ArtifactTransaction,
    input: Omit<ContentObjectQuarantineInput, 'reasonCode' | 'safeSummary'>,
  ): Promise<ContentObjectStateOutcome> {
    const result = await sql<{ outcome: ContentObjectStateOutcome }>`
      SELECT artifact.freeze_content_object(
        CAST(${input.contentObjectId} AS uuid),
        CAST(${input.expectedVersion} AS bigint),
        CAST(${input.updatedByPrincipalId} AS uuid),
        CAST(${input.updatedByActorSnapshotId} AS uuid),
        CAST(${input.lastAuthorizationDecisionId} AS uuid),
        CAST(${input.sourceCommandId} AS uuid)
      ) AS outcome
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'NOT_FOUND';
  }

  async quarantineContentObject(
    trx: ArtifactTransaction,
    input: ContentObjectQuarantineInput,
  ): Promise<ContentObjectStateOutcome> {
    const result = await sql<{ outcome: ContentObjectStateOutcome }>`
      SELECT artifact.quarantine_content_object(
        CAST(${input.contentObjectId} AS uuid),
        CAST(${input.expectedVersion} AS bigint),
        ${input.reasonCode},
        ${input.safeSummary},
        CAST(${input.updatedByPrincipalId} AS uuid),
        CAST(${input.updatedByActorSnapshotId} AS uuid),
        CAST(${input.lastAuthorizationDecisionId} AS uuid),
        CAST(${input.sourceCommandId} AS uuid)
      ) AS outcome
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'NOT_FOUND';
  }

  async insertContentObjectOrphan(
    trx: ArtifactTransaction,
    input: ContentObjectOrphanInsert,
  ): Promise<string> {
    const result = await sql<{ orphan_id: string }>`
      SELECT artifact.record_content_object_orphan(
        CAST(${input.orphanId} AS uuid),
        CAST(${input.contentObjectId} AS uuid),
        CAST(${input.enterpriseId} AS uuid),
        CAST(${input.projectId ?? null} AS uuid),
        CAST(${input.contentHash} AS bytea),
        CAST(${input.byteSize} AS bigint),
        ${input.mediaType},
        ${input.storageProvider},
        ${input.objectLocator},
        ${input.objectVersionId},
        ${input.storageState},
        ${input.retentionClass},
        CAST(${input.retentionUntil ?? null} AS timestamptz),
        ${input.legalHold},
        CAST(${input.createdByPrincipalId} AS uuid),
        CAST(${input.createdByActorSnapshotId} AS uuid),
        CAST(${input.createdAuthorizationDecisionId} AS uuid),
        CAST(${input.sourceCommandId ?? null} AS uuid)
      ) AS orphan_id
    `.execute(trx);
    const orphanId = result.rows[0]?.orphan_id;
    if (orphanId === undefined) throw new Error('orphan record was not created');
    return orphanId;
  }

  async claimContentObjectOrphan(
    trx: ArtifactTransaction,
    worker: string,
    leaseToken: string,
  ): Promise<ContentObjectOrphanClaim | undefined> {
    const result = await sql<ContentObjectOrphanClaim>`
      SELECT * FROM artifact.claim_content_object_orphan(
        ${worker}, CAST(${leaseToken} AS uuid))
    `.execute(trx);
    return result.rows[0];
  }

  async completeContentObjectOrphan(
    trx: ArtifactTransaction,
    orphanId: string,
    worker: string,
    leaseToken: string,
    deleteOutcome: 'DELETED' | 'NOT_FOUND' | 'UNKNOWN',
    errorCode?: string,
  ): Promise<ContentObjectOrphanCompletion> {
    const result = await sql<{ outcome: ContentObjectOrphanCompletion }>`
      SELECT artifact.complete_content_object_orphan(
        CAST(${orphanId} AS uuid),
        ${worker},
        CAST(${leaseToken} AS uuid),
        ${deleteOutcome},
        ${errorCode ?? null}
      ) AS outcome
    `.execute(trx);
    return result.rows[0]?.outcome ?? 'FENCED';
  }

  async insertContentAudit(trx: ArtifactTransaction, input: ContentAuditInsert): Promise<void> {
    await trx
      .insertInto('artifact.audit_record')
      .values({
        audit_id: input.auditId,
        enterprise_id: input.enterpriseId,
        project_id: input.projectId ?? null,
        principal_id: input.principalId,
        actor_snapshot_id: input.actorSnapshotId,
        authorization_decision_id: input.authorizationDecisionId,
        command_id: input.commandId ?? null,
        command_type: input.commandType,
        outcome: input.outcome,
        error_code: input.errorCode ?? null,
        request_payload_hash: input.sourceRequestHash ?? null,
        target_type: input.targetType ?? null,
        target_id: input.targetId ?? null,
        correlation_id: input.correlationId,
        safe_summary: input.safeSummary,
        retention_class: 'REGULATED_AUDIT',
      })
      .execute();
  }

  async insertProcessInstance(trx: ArtifactTransaction, insert: ProcessInstanceInsert) {
    const context = await sql<{
      principal_id: string | null;
      enterprise_id: string | null;
    }>`
      SELECT platform_security.context_principal_id() AS principal_id,
             platform_security.context_enterprise_id() AS enterprise_id
    `.execute(trx);
    const trusted = context.rows[0];
    if (trusted?.principal_id !== insert.createdByPrincipalId) {
      throw new ArtifactPersistenceError(
        ARTIFACT_CONTEXT_PRINCIPAL_MISMATCH,
        'created-by principal does not match the trusted transaction context',
      );
    }
    if (trusted.enterprise_id !== insert.enterpriseId) {
      throw new ArtifactPersistenceError(
        ARTIFACT_CONTEXT_SCOPE_MISMATCH,
        'process enterprise scope does not match the trusted transaction context',
      );
    }
    if (insert.projectId !== undefined) {
      const projectScope = await sql<{ allowed: boolean }>`
        SELECT platform_security.context_allows_project(
          ${insert.enterpriseId}, ${insert.projectId}) AS allowed
      `.execute(trx);
      if (projectScope.rows[0]?.allowed !== true) {
        throw new ArtifactPersistenceError(
          ARTIFACT_CONTEXT_SCOPE_MISMATCH,
          'process project scope is not allowed by the trusted transaction context',
        );
      }
    }
    await trx
      .insertInto('artifact.process_instance')
      .values({
        process_id: insert.processId,
        process_type: insert.processType,
        process_version: insert.processVersion,
        correlation_key: insert.correlationKey,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId ?? null,
        state: insert.state ?? 'ACTIVE',
        created_by_principal_id: insert.createdByPrincipalId,
      })
      .execute();
  }

  async getProcessInstanceById(trx: ArtifactTransaction, processId: string) {
    return trx
      .selectFrom('artifact.process_instance')
      .selectAll()
      .where('process_id', '=', processId)
      .executeTakeFirst();
  }
}
