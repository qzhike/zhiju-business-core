// IM-06 WI-01 (issue #151): repository for TaskExecution technical facts.
// Business tables, cross-schema reads, and IdentityPolicy lookups remain
// deliberately outside this repository. CAS and identity-bound writes all go
// through the command-runner; this file only exposes inserts that the runner
// itself can perform inside its open transaction.

import type { TaskExecutionTransaction } from './task-execution-db.js';

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

export class TaskExecutionRepository {
  /**
   * Inserts a fresh process_instance row in the current transaction. The
   * caller must already hold a trusted TaskExecution context (the runner
   * establishes it before invoking the body). Scope mirror and creator
   * attribution are enforced by the database constraints and the WI-03 RLS
   * policies; this helper only translates typed input into SQL.
   */
  async insertProcessInstance(
    trx: TaskExecutionTransaction,
    row: ProcessInstanceInsert,
  ): Promise<void> {
    await trx
      .insertInto('task_execution.process_instance')
      .values({
        process_id: row.processId,
        process_type: row.processType,
        process_version: row.processVersion,
        correlation_key: row.correlationKey,
        enterprise_id: row.enterpriseId,
        project_id: row.projectId ?? null,
        state: row.state ?? 'ACTIVE',
        created_by_principal_id: row.createdByPrincipalId,
      })
      .execute();
  }
}
