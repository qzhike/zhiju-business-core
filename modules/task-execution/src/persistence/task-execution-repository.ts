// IM-06 WI-01 (issue #151): repository for TaskExecution technical facts.
// Business tables, cross-schema reads, and IdentityPolicy lookups remain
// deliberately outside this repository. CAS and identity-bound writes all go
// through the command-runner; this file only exposes inserts that the runner
// itself can perform inside its open transaction.

import { sql } from 'kysely';
import type { TaskExecutionTransaction } from './task-execution-db.js';
import {
  TaskExecutionPersistenceError,
  TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH,
  TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
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

interface TrustedContextFacts {
  principal_id: string;
  enterprise_id: string;
  allowsEnterprise: boolean;
  allowsProject: boolean | null;
}

async function readTrustedContext(
  trx: TaskExecutionTransaction,
  enterpriseId: string,
  projectId: string | null,
): Promise<TrustedContextFacts> {
  const principalRow = await sql<{
    principal_id: string | null;
  }>`SELECT platform_security.context_principal_id() AS principal_id`.execute(trx);
  const enterpriseRow = await sql<{
    enterprise_id: string | null;
  }>`SELECT platform_security.context_enterprise_id() AS enterprise_id`.execute(trx);
  const principal = principalRow.rows[0]?.principal_id;
  const enterprise = enterpriseRow.rows[0]?.enterprise_id;
  if (!principal || !enterprise) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH,
      'task_execution repository requires an established transaction context',
    );
  }
  const enterpriseMatch = await sql<{
    allows: boolean;
  }>`SELECT platform_security.context_allows_enterprise(${enterpriseId}) AS allows`.execute(trx);
  const allowsEnterprise = enterpriseMatch.rows[0]?.allows === true;
  let allowsProject: boolean | null = null;
  if (projectId !== null) {
    const projectMatch = await sql<{
      allows: boolean;
    }>`SELECT platform_security.context_allows_project(${enterpriseId}, ${projectId}) AS allows`.execute(
      trx,
    );
    allowsProject = projectMatch.rows[0]?.allows === true;
  }
  return {
    principal_id: principal,
    enterprise_id: enterprise,
    allowsEnterprise,
    allowsProject,
  };
}

export class TaskExecutionRepository {
  /**
   * Inserts a fresh process_instance row in the current transaction. The
   * caller must already hold a trusted TaskExecution context (the runner
   * establishes it before invoking the body). The creator attribution, the
   * Enterprise scope and the Project scope are re-checked against the
   * trusted context row in `platform_security.tx_context`; any mismatch
   * raises `TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH` or
   * `TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH` so that a misuse from another
   * module role cannot smuggle a different creator or scope.
   */
  async insertProcessInstance(
    trx: TaskExecutionTransaction,
    row: ProcessInstanceInsert,
  ): Promise<void> {
    const requestedProjectId = row.projectId ?? null;
    const trusted = await readTrustedContext(trx, row.enterpriseId, requestedProjectId);
    if (row.createdByPrincipalId !== trusted.principal_id) {
      throw new TaskExecutionPersistenceError(
        TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH,
        'process creator must equal the trusted transaction principal',
      );
    }
    if (!trusted.allowsEnterprise) {
      throw new TaskExecutionPersistenceError(
        TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
        'process enterprise scope is not allowed by the trusted transaction context',
      );
    }
    if (requestedProjectId !== null && trusted.allowsProject !== true) {
      throw new TaskExecutionPersistenceError(
        TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
        'process project scope is not allowed by the trusted transaction context',
      );
    }
    await trx
      .insertInto('task_execution.process_instance')
      .values({
        process_id: row.processId,
        process_type: row.processType,
        process_version: row.processVersion,
        correlation_key: row.correlationKey,
        enterprise_id: row.enterpriseId,
        project_id: requestedProjectId,
        state: row.state ?? 'ACTIVE',
        created_by_principal_id: row.createdByPrincipalId,
      })
      .execute();
  }
}
