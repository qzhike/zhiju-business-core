// IM-03 WI-02 (issue #58): technical-table repository for EnterpriseProject.
// No business aggregates live here. process_instance is the CAS stand-in
// until WI-03 business tables exist. This type never reaches across into
// identity_policy.

import { sql } from 'kysely';
import type { EnterpriseProjectTransaction } from './enterprise-db.js';
import {
  EnterprisePersistenceError,
  ENTERPRISE_CONTEXT_PRINCIPAL_MISMATCH,
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

export class EnterpriseProjectRepository {
  async insertProcessInstance(trx: EnterpriseProjectTransaction, insert: ProcessInstanceInsert) {
    const context = await sql<{ principal_id: string | null }>`
      SELECT platform_security.context_principal_id() AS principal_id
    `.execute(trx);
    if (context.rows[0]?.principal_id !== insert.createdByPrincipalId) {
      throw new EnterprisePersistenceError(
        ENTERPRISE_CONTEXT_PRINCIPAL_MISMATCH,
        'created-by principal does not match the trusted transaction context',
      );
    }
    await trx
      .insertInto('enterprise_project.process_instance')
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

  async getProcessInstanceById(trx: EnterpriseProjectTransaction, processId: string) {
    return trx
      .selectFrom('enterprise_project.process_instance')
      .selectAll()
      .where('process_id', '=', processId)
      .executeTakeFirst();
  }
}
