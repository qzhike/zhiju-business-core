import { newUuidV7 } from '@zhiju/shared-kernel';
import { expect } from 'vitest';
import type {
  ScenarioFirstRunEnvelope,
  ScenarioTerminalScenario,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifyFinalSqlContext {
  readonly firstRunEnvelope: ScenarioFirstRunEnvelope;
  readonly terminalScenario: ScenarioTerminalScenario;
  admin: InitialContextSuite['admin'];
  readonly receiptRows: InitialContextSuite['receiptRows'];
}

export async function verifyFinalSql(
  scenarioState: VerifyFinalSqlContext,
  envelope: Awaited<ReturnType<typeof scenarioState.firstRunEnvelope>>,
  execute: (value: unknown) => Promise<unknown>,
): Promise<void> {
  if (scenarioState.terminalScenario !== 'SUCCEEDED') return;
  const insertTables: Record<string, readonly string[]> = {
    'execution.submit_agent_result': ['agent_result', 'run_final_submission_claim'],
    'execution.validate_agent_result': [
      'execution_judgment',
      'result_validation_bundle',
      'result_validation_fact',
    ],
    'execution.accept_agent_result': ['agent_result_acceptance'],
  };
  const tables = insertTables[envelope.commandType] ?? ['run'];
  for (const table of tables) {
    const event = table === 'run' ? 'UPDATE' : 'INSERT';
    const condition =
      table === 'run'
        ? `NEW.last_command_id='${envelope.commandId}'::uuid`
        : `NEW.source_command_id='${envelope.commandId}'::uuid`;
    // The app's real INSERT/UPDATE has a valid PENDING Receipt. The
    // first trigger changes one mirror; the last trigger rolls every
    // accepted probe back. The no-change probe must reach that marker.
    const sourceField = table === 'run' ? 'last_command_id' : 'source_command_id';
    const mutations: (readonly [string, string])[] = [
      ['source Receipt', `NEW.${sourceField}:='${newUuidV7()}'::uuid;`],
      ['Enterprise Scope', `NEW.enterprise_id:='${newUuidV7()}'::uuid;`],
      ['Project Scope', `NEW.project_id:='${newUuidV7()}'::uuid;`],
    ];
    if (table === 'agent_result' || table === 'run_final_submission_claim') {
      mutations.push(
        ['Result Hash', "NEW.result_payload_hash:=decode(repeat('0',64),'hex');"],
        [
          'observation Scope',
          `NEW.observation_ref:=jsonb_set(NEW.observation_ref,'{scope,projectId}',to_jsonb('${newUuidV7()}'::text));`,
        ],
      );
    }
    if (table === 'agent_result') {
      mutations.push(
        [
          'Attempt Ref',
          `NEW.attempt_ref:=jsonb_set(NEW.attempt_ref,'{objectId}',to_jsonb('${newUuidV7()}'::text));`,
        ],
        [
          'Adapter Ref',
          `NEW.adapter_identity_ref:=jsonb_set(NEW.adapter_identity_ref,'{objectId}',to_jsonb('${newUuidV7()}'::text));`,
        ],
        ['fencing', 'NEW.fencing_token:=NEW.fencing_token+1;'],
      );
      for (const [label, path] of [
        ['Result Run Scope', '{runRef,scope,projectId}'],
        ['Result Header Scope', '{header,scopeRef,projectId}'],
      ] as const) {
        mutations.push([
          label,
          `NEW.result_payload:=jsonb_set(NEW.result_payload,'${path}',to_jsonb('${newUuidV7()}'::text));
                NEW.result_payload_hash:=sha256(convert_to(task_execution.canonical_jsonb_text(NEW.result_payload #- '{header,payloadHash}'),'UTF8'));
                NEW.result_payload:=jsonb_set(NEW.result_payload,'{header,payloadHash,digest}',to_jsonb(encode(NEW.result_payload_hash,'hex')));`,
        ]);
      }
    }
    if (
      [
        'execution_judgment',
        'result_validation_bundle',
        'result_validation_fact',
        'agent_result_acceptance',
      ].includes(table)
    ) {
      mutations.push(['payload Hash', "NEW.payload_hash:=decode(repeat('0',64),'hex');"]);
    }
    if (table === 'result_validation_bundle') {
      mutations.push(
        [
          'Evaluator Ref',
          `NEW.evaluator_ref:=jsonb_set(NEW.evaluator_ref,'{versionId}',to_jsonb('${newUuidV7()}'::text));`,
        ],
        [
          'Policy Ref',
          `NEW.policy_ref:=jsonb_set(NEW.policy_ref,'{versionId}',to_jsonb('${newUuidV7()}'::text));`,
        ],
        [
          'Attempt Ref',
          `NEW.attempt_ref:=jsonb_set(NEW.attempt_ref,'{objectId}',to_jsonb('${newUuidV7()}'::text));`,
        ],
        ['validUntil mirror', "NEW.valid_until:=NEW.valid_until-interval '1 second';"],
      );
    }
    if (table === 'result_validation_fact') {
      mutations.push(['Bundle Ref', `NEW.bundle_id:='${newUuidV7()}'::uuid;`]);
      for (const [label, path] of [
        ['child validUntil', '{validUntil}'],
        ['child Run', '{runRef,objectId}'],
        ['child Result', '{agentResultRef,objectId}'],
        ['child Attempt', '{attemptRef,objectId}'],
        ['child observation', '{observationRef,objectId}'],
        ['child Policy', '{policyRef,versionId}'],
        ['child Evaluator', '{evaluatorRef,versionId}'],
      ] as const)
        mutations.push([
          label,
          `NEW.canonical_payload:=jsonb_set(NEW.canonical_payload,'${path}',to_jsonb('${newUuidV7()}'::text));
              NEW.payload_hash:=sha256(convert_to(task_execution.canonical_jsonb_text(NEW.canonical_payload),'UTF8'));`,
        ]);
    }
    if (table === 'agent_result_acceptance') {
      mutations.push(
        ['Result Ref', `NEW.result_id:='${newUuidV7()}'::uuid;`],
        ['Bundle Ref', `NEW.bundle_id:='${newUuidV7()}'::uuid;`],
      );
    }
    if (table === 'run') {
      const field =
        envelope.commandType === 'execution.record_run_result' ? 'result_ref' : 'acceptance_ref';
      mutations.push(
        [
          'fact Hash',
          `NEW.${field}:=jsonb_set(NEW.${field},'{contentHash,digest}',to_jsonb(repeat('0',64)));`,
        ],
        [
          'fact Ref Scope',
          `NEW.${field}:=jsonb_set(NEW.${field},'{scope,projectId}',to_jsonb('${newUuidV7()}'::text));`,
        ],
      );
    }
    await scenarioState.admin
      .query(`CREATE FUNCTION task_execution.wi224_sql_probe_end() RETURNS trigger
            LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'WI224_SQL_PROBE_ACCEPTED'; END $f$`);
    await scenarioState.admin
      .query(`CREATE TRIGGER zz_wi224_sql_probe AFTER ${event} ON task_execution.${table}
            FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION task_execution.wi224_sql_probe_end()`);
    const probe = async (statement: string) => {
      await scenarioState.admin
        .query(`CREATE FUNCTION task_execution.wi224_sql_probe_change() RETURNS trigger
              LANGUAGE plpgsql AS $f$ BEGIN ${statement} RETURN NEW; END $f$`);
      await scenarioState.admin
        .query(`CREATE TRIGGER aa_wi224_sql_probe BEFORE ${event} ON task_execution.${table}
              FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION task_execution.wi224_sql_probe_change()`);
      try {
        await execute(envelope);
        return 'UNEXPECTED_SUCCESS';
      } catch (error) {
        if (error instanceof Error && error.message.includes('WI224_SQL_PROBE_ACCEPTED'))
          return 'ACCEPTED';
        return error !== null && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : 'UNKNOWN';
      } finally {
        await scenarioState.admin.query(
          `DROP TRIGGER aa_wi224_sql_probe ON task_execution.${table}`,
        );
        await scenarioState.admin.query('DROP FUNCTION task_execution.wi224_sql_probe_change()');
      }
    };
    try {
      expect(await probe(''), `${table} valid source baseline`).toBe('ACCEPTED');
      const outcomes: { label: string; code: string }[] = [];
      for (const [label, statement] of mutations)
        outcomes.push({ label, code: await probe(statement) });
      // Soft assertions preserve the original Run's cleanup even when
      // a guard is missing; accepted probes have already rolled back.
      for (const outcome of outcomes)
        expect
          .soft(
            ['22023', '23514', '42501', '23503', '23505'],
            `${table} ${outcome.label}: ${outcome.code}`,
          )
          .toContain(outcome.code);
      expect(await scenarioState.receiptRows(envelope.idempotencyKey)).toEqual([]);
    } finally {
      await scenarioState.admin.query(`DROP TRIGGER zz_wi224_sql_probe ON task_execution.${table}`);
      await scenarioState.admin.query('DROP FUNCTION task_execution.wi224_sql_probe_end()');
    }
  }
}
