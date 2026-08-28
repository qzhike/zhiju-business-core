// IM-04 WI-02/WI-03 (issues #91/#92): repository for Artifact technical facts
// and the Root/Branch business write boundary. Cross-schema reads remain
// deliberately outside this repository.

import { sql } from 'kysely';
import type { ArtifactTransaction } from './artifact-db.js';
import type { ArtifactBranchTable, ArtifactTable } from './artifact-business-types.js';
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
