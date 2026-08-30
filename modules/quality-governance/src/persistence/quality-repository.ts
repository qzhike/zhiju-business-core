// IM-05 WI-01 (issue #121): narrow repository for QualityGovernance-owned
// technical Process facts. Business aggregates are introduced by later WIs.

import { sql } from 'kysely';
import type { QualityTransaction } from './quality-db.js';
import {
  QualityPersistenceError,
  QUALITY_CONTEXT_PRINCIPAL_MISMATCH,
  QUALITY_CONTEXT_SCOPE_MISMATCH,
} from './write-guards.js';

export interface ProcessInstanceInsert {
  readonly processId: string;
  readonly processType: string;
  readonly processVersion: string;
  readonly correlationKey: string;
  readonly enterpriseId: string;
  readonly projectId?: string;
  readonly state?: 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'SUSPENDED';
  readonly createdByPrincipalId: string;
}

export interface ProcessStepInsert {
  readonly processStepId: string;
  readonly processId: string;
  readonly stepNo: number;
  readonly enterpriseId: string;
  readonly projectId?: string;
  readonly inputEventId?: string;
  readonly inputEventType?: string;
  readonly issuedCommandId?: string;
  readonly issuedCommandType?: string;
  readonly outcome: 'STARTED' | 'COMPLETED' | 'FAILED' | 'AWAITING_HUMAN' | 'SKIPPED';
  readonly failureCode?: string;
  readonly humanIntervention?: string;
  readonly createdByPrincipalId: string;
}

async function assertTrustedScope(
  trx: QualityTransaction,
  input: {
    readonly enterpriseId: string;
    readonly projectId?: string;
    readonly principalId: string;
  },
): Promise<void> {
  const context = await sql<{ principal_id: string | null; enterprise_id: string | null }>`
    SELECT platform_security.context_principal_id() AS principal_id,
           platform_security.context_enterprise_id() AS enterprise_id
  `.execute(trx);
  const trusted = context.rows[0];
  if (trusted?.principal_id !== input.principalId) {
    throw new QualityPersistenceError(
      QUALITY_CONTEXT_PRINCIPAL_MISMATCH,
      'created-by principal does not match the trusted transaction context',
    );
  }
  if (trusted.enterprise_id !== input.enterpriseId) {
    throw new QualityPersistenceError(
      QUALITY_CONTEXT_SCOPE_MISMATCH,
      'enterprise scope does not match the trusted transaction context',
    );
  }
  if (input.projectId !== undefined) {
    const project = await sql<{ allowed: boolean }>`
      SELECT platform_security.context_allows_project(
        ${input.enterpriseId}, ${input.projectId}) AS allowed
    `.execute(trx);
    if (project.rows[0]?.allowed !== true) {
      throw new QualityPersistenceError(
        QUALITY_CONTEXT_SCOPE_MISMATCH,
        'project scope is not allowed by the trusted transaction context',
      );
    }
  }
}

export class QualityGovernanceRepository {
  async insertProcessInstance(
    trx: QualityTransaction,
    input: ProcessInstanceInsert,
  ): Promise<void> {
    await assertTrustedScope(trx, {
      enterpriseId: input.enterpriseId,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      principalId: input.createdByPrincipalId,
    });
    await trx
      .insertInto('quality_governance.process_instance')
      .values({
        process_id: input.processId,
        process_type: input.processType,
        process_version: input.processVersion,
        correlation_key: input.correlationKey,
        enterprise_id: input.enterpriseId,
        project_id: input.projectId ?? null,
        state: input.state ?? 'ACTIVE',
        created_by_principal_id: input.createdByPrincipalId,
      })
      .execute();
  }

  async appendProcessStep(trx: QualityTransaction, input: ProcessStepInsert): Promise<void> {
    await assertTrustedScope(trx, {
      enterpriseId: input.enterpriseId,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      principalId: input.createdByPrincipalId,
    });
    await trx
      .insertInto('quality_governance.process_step')
      .values({
        process_step_id: input.processStepId,
        process_id: input.processId,
        step_no: input.stepNo,
        enterprise_id: input.enterpriseId,
        project_id: input.projectId ?? null,
        input_event_id: input.inputEventId ?? null,
        input_event_type: input.inputEventType ?? null,
        issued_command_id: input.issuedCommandId ?? null,
        issued_command_type: input.issuedCommandType ?? null,
        outcome: input.outcome,
        failure_code: input.failureCode ?? null,
        human_intervention: input.humanIntervention ?? null,
        created_by_principal_id: input.createdByPrincipalId,
      })
      .execute();
  }

  async getProcessInstance(trx: QualityTransaction, processId: string) {
    return trx
      .selectFrom('quality_governance.process_instance')
      .selectAll()
      .where('process_id', '=', processId)
      .executeTakeFirst();
  }
}
