// IM-04 WI-02/WI-03 (issues #91/#92): repository for Artifact technical facts
// and the Root/Branch business write boundary. Cross-schema reads remain
// deliberately outside this repository.

import { sql } from 'kysely';
import type { ArtifactTransaction } from './artifact-db.js';
import type {
  ArtifactBranchTable,
  ArtifactContentObjectLinkTable,
  ArtifactContentObjectTable,
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
