import type {
  createBlockedInputRecoveryEntry,
  createFormalCompletionEntry,
} from '@zhiju/api/composition';
import { type Common, registeredEvaluatorProfileReference } from '@zhiju/contracts';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import pg from 'pg';
import { expect } from 'vitest';
import { definedValue, type Principal } from './initial-context-fixtures.js';
import type {
  ScenarioFormalEnvelope,
  ScenarioRecoveryEnvelope,
  ScenarioTerminalScenario,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifyRecoveryCompletionRaceContext {
  readonly terminalScenario: ScenarioTerminalScenario;
  admin: InitialContextSuite['admin'];
  readonly taskId: string;
  readonly recoveryEntryRaw: ReturnType<typeof createBlockedInputRecoveryEntry>;
  readonly recoveryEnvelope: ScenarioRecoveryEnvelope;
  readonly revised: Record<string, unknown>;
  readonly runRef: Common.ObjectRef;
  service: Principal;
  readonly sessionFor: InitialContextSuite['sessionFor'];
  readonly formalEnvelope: ScenarioFormalEnvelope;
  readonly completionRef: Common.VersionedRef;
  activeDatabaseUrl: InitialContextSuite['activeDatabaseUrl'];
  readonly formalEntry: ReturnType<typeof createFormalCompletionEntry>;
  readonly receiptRows: InitialContextSuite['receiptRows'];
  readonly open: Record<string, unknown>;
  readonly requestRef: Common.ObjectRef;
}

export async function verifyRecoveryCompletionRace(
  scenarioState: VerifyRecoveryCompletionRaceContext,
): Promise<boolean> {
  if (scenarioState.terminalScenario.startsWith('FORMAL_REQUEST_')) {
    const taskVersion = Number(
      definedValue(
        (
          await scenarioState.admin.query<{ aggregate_version: string }>(
            'SELECT aggregate_version FROM task_execution.task WHERE task_id=$1',
            [scenarioState.taskId],
          )
        ).rows[0],
      ).aggregate_version,
    );
    expect(
      await scenarioState.recoveryEntryRaw.command(
        await scenarioState.recoveryEnvelope(
          'taskReconcileV1',
          scenarioState.revised.taskRef as Common.ObjectRef,
          { triggerRef: scenarioState.runRef } as unknown as CanonicalJsonObject,
          scenarioState.service,
          taskVersion,
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({ status: 'COMMITTED', resultPayload: { status: 'WAITING_INPUT' } });
    const beforeTask = (
      await scenarioState.admin.query(
        'SELECT status,aggregate_version FROM task_execution.task WHERE task_id=$1',
        [scenarioState.taskId],
      )
    ).rows;
    const completion = await scenarioState.formalEnvelope(
      'taskCompletionEvaluateV2',
      scenarioState.revised.taskRef as Common.ObjectRef,
      {
        policyRef: scenarioState.completionRef,
        evaluatorRef: registeredEvaluatorProfileReference(
          'im06-evaluator-static-v1',
          'te.task_completion.evaluator@1.0',
        ),
      } as unknown as CanonicalJsonObject,
      scenarioState.service,
      taskVersion + 1,
    );
    if (!('commandId' in completion)) throw new Error('Expected Completion command');
    const blocker = new pg.Client({ connectionString: scenarioState.activeDatabaseUrl });
    await blocker.connect();
    let opening: ReturnType<typeof scenarioState.recoveryEntryRaw.command> | undefined;
    const refuse = async () => {
      await expect(
        scenarioState.formalEntry.evaluateTask(
          completion,
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).rejects.toMatchObject({ code: 'EXECUTION_COMPLETION_STATE_CONFLICT' });
      expect(await scenarioState.receiptRows(String(completion.idempotencyKey))).toEqual([]);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT evaluation_id FROM task_execution.completion_evaluation WHERE source_command_id=$1',
            [completion.commandId],
          )
        ).rows,
      ).toEqual([]);
    };
    try {
      await blocker.query('BEGIN');
      const pid = definedValue(
        (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0],
      ).pid;
      await blocker.query('SELECT task_id FROM task_execution.task WHERE task_id=$1 FOR UPDATE', [
        scenarioState.taskId,
      ]);
      if (scenarioState.terminalScenario === 'FORMAL_REQUEST_COMPLETION_FIRST') await refuse();
      opening = scenarioState.recoveryEntryRaw.command(
        scenarioState.open,
        scenarioState.sessionFor(scenarioState.service),
      );
      await expect
        .poll(
          async () =>
            definedValue(
              (
                await scenarioState.admin.query<{ n: number }>(
                  'SELECT count(*)::int n FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',
                  [pid],
                )
              ).rows[0],
            ).n,
          { timeout: 10000 },
        )
        .toBeGreaterThan(0);
      if (scenarioState.terminalScenario === 'FORMAL_REQUEST_OPEN_FIRST') await refuse();
      await blocker.query('ROLLBACK');
      expect(await opening).toMatchObject({ status: 'COMMITTED' });
      expect(
        (
          await scenarioState.admin.query(
            "SELECT request_id,task_id,definition->'runRef'->>'objectId' run_id FROM task_execution.information_request WHERE request_id=$1",
            [scenarioState.requestRef.objectId],
          )
        ).rows,
      ).toEqual([
        {
          request_id: scenarioState.requestRef.objectId,
          task_id: scenarioState.taskId,
          run_id: scenarioState.runRef.objectId,
        },
      ]);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT request_id FROM task_execution.information_request_origin WHERE request_id=$1',
            [scenarioState.requestRef.objectId],
          )
        ).rows,
      ).toEqual([{ request_id: scenarioState.requestRef.objectId }]);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT status,aggregate_version FROM task_execution.task WHERE task_id=$1',
            [scenarioState.taskId],
          )
        ).rows,
      ).toEqual(beforeTask);
      expect(
        (
          await scenarioState.admin.query(
            "SELECT count(*)::int n FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.TaskCompleted'",
            [scenarioState.taskId],
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
      if (opening) await Promise.allSettled([opening]);
    }
    return true;
  }
  return false;
}
