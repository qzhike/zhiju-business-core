import { newUuidV7 } from '@zhiju/shared-kernel';
import { expect } from 'vitest';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifyRecoverySqlContext {
  readonly recoverySqlVerified: Set<string>;
  admin: InitialContextSuite['admin'];
}

export async function verifyRecoverySql(
  scenarioState: VerifyRecoverySqlContext,
  envelope: Record<string, unknown>,
  execute: () => Promise<unknown>,
): Promise<void> {
  const type = typeof envelope.commandType === 'string' ? envelope.commandType : '';
  if (scenarioState.recoverySqlVerified.has(type)) return;
  scenarioState.recoverySqlVerified.add(type);
  const tables: Record<string, string[]> = {
    'execution.open_information_request': ['information_request_origin'],
    'execution.submit_information_answer': ['answer_submission'],
    'execution.resolve_information_request': [
      'answer_resolution',
      'resolution_receipt_observation',
    ],
    'execution.build_context_snapshot': ['context_snapshot_build'],
    'execution.schedule_work_order_retry': ['work_order_retry_intent'],
    'execution.create_run': ['run_retry_intent_consumption', 'run_budget_reservation'],
    'execution.finalize_run_from_acceptance': ['run_budget_consumption'],
  };
  const id = String(envelope.commandId);
  for (const table of tables[type] ?? []) {
    const columns = (
      await scenarioState.admin.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='task_execution' AND table_name=$1",
        [table],
      )
    ).rows.map((r) => r.column_name);
    const mutations = [
      ['Scope', `NEW.project_id:='${newUuidV7()}'::uuid;`],
      ['source Receipt', `NEW.source_command_id:='${newUuidV7()}'::uuid;`],
      ...(columns.includes('payload_hash')
        ? [['canonical Hash', "NEW.payload_hash:=decode(repeat('0',64),'hex');"]]
        : []),
      ...(columns.includes('canonical_payload')
        ? [
            [
              'missing full reference',
              "NEW.canonical_payload:='{}'::jsonb; NEW.payload_hash:=task_execution.recovery_payload_hash(NEW.canonical_payload);",
            ],
            [
              'unknown canonical member',
              'NEW.canonical_payload:=NEW.canonical_payload||\'{"unexpected":true}\'::jsonb; NEW.payload_hash:=task_execution.recovery_payload_hash(NEW.canonical_payload);',
            ],
            [
              'null full Ref',
              `NEW.canonical_payload:=jsonb_set(NEW.canonical_payload,'{${table === 'context_snapshot_build' ? 'frozenContractRef' : table === 'work_order_retry_intent' || table === 'run_retry_intent_consumption' ? 'workOrderContractRef' : table === 'resolution_receipt_observation' ? 'targetRef' : 'informationRequestRef'}}','null'::jsonb); NEW.payload_hash:=task_execution.recovery_payload_hash(NEW.canonical_payload);`,
            ],
          ]
        : []),
    ];
    for (const [label, statement] of mutations) {
      await scenarioState.admin.query(
        `CREATE FUNCTION task_execution.wi231_mutation() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN ${statement} RETURN NEW; END $f$`,
      );
      await scenarioState.admin.query(
        `CREATE TRIGGER aa_wi231_mutation BEFORE INSERT ON task_execution.${table} FOR EACH ROW WHEN (NEW.source_command_id='${id}'::uuid) EXECUTE FUNCTION task_execution.wi231_mutation()`,
      );
      try {
        await expect(
          execute().catch((error: unknown) => {
            if (
              error !== null &&
              typeof error === 'object' &&
              'code' in error &&
              !['22023', '23514', '23503', '42501', '23502'].includes(String(error.code))
            )
              throw new Error(`SQL probe ${table}/${label}: ${String(error.code)}`);
            throw error;
          }),
          `TE-REC-D-011 ${table} ${label}`,
        ).rejects.toSatisfy(
          (error: unknown) =>
            error !== null &&
            typeof error === 'object' &&
            'code' in error &&
            ['22023', '23514', '23503', '42501', '23502'].includes(String(error.code)),
        );
      } finally {
        await scenarioState.admin.query(
          `DROP TRIGGER aa_wi231_mutation ON task_execution.${table}`,
        );
        await scenarioState.admin.query('DROP FUNCTION task_execution.wi231_mutation()');
      }
    }
  }
  const omitted: Record<string, string[]> = {
    'execution.open_information_request': ['information_request_origin'],
    'execution.submit_information_answer': ['answer_submission'],
    'execution.resolve_information_request': ['resolution_receipt_observation'],
    'execution.create_run': ['run_retry_intent_consumption', 'run_budget_reservation'],
    'execution.finalize_run_from_acceptance': ['run_budget_consumption'],
  };
  for (const table of omitted[type] ?? []) {
    await scenarioState.admin.query(
      'CREATE FUNCTION task_execution.wi231_omit() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$',
    );
    await scenarioState.admin.query(
      `CREATE TRIGGER aa_wi231_omit BEFORE INSERT ON task_execution.${table} FOR EACH ROW WHEN (NEW.source_command_id='${id}'::uuid) EXECUTE FUNCTION task_execution.wi231_omit()`,
    );
    try {
      await expect(execute(), `TE-REC-D-011 required ${table}`).rejects.toMatchObject({
        code: '23514',
      });
    } finally {
      await scenarioState.admin.query(`DROP TRIGGER aa_wi231_omit ON task_execution.${table}`);
      await scenarioState.admin.query('DROP FUNCTION task_execution.wi231_omit()');
    }
  }
}
