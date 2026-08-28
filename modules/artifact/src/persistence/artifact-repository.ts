// IM-04 WI-02 (issue #91): technical-table repository for Artifact.
// `process_instance` is the CAS stand-in until later WI-03 business tables
// exist. No Artifact business aggregate is created in this work item.

import { sql } from 'kysely';
import type { ArtifactTransaction } from './artifact-db.js';
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

export class ArtifactRepository {
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
