// IM-03 WI-02 (issue #58): technical-table repository for EnterpriseProject.
// No business aggregates live here. process_instance is the CAS stand-in
// until WI-03 business tables exist. This type never reaches across into
// identity_policy.

import type { EnterpriseProjectTransaction } from './enterprise-db.js';

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
