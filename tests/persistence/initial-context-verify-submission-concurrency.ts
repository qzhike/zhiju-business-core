import type { createControlledFirstRunEntry } from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import { CONTROLLED_FIRST_RUN_BINDINGS } from '@zhiju/identity-policy';
import { type CanonicalJsonObject, newUuidV7 } from '@zhiju/shared-kernel';
import pg from 'pg';
import { expect } from 'vitest';
import { definedValue, type Principal } from './initial-context-fixtures.js';
import type {
  ScenarioFinalView,
  ScenarioFirstRunCodes,
  ScenarioFirstRunEnvelope,
  ScenarioStartEnvelope,
  ScenarioTerminalScenario,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifySubmissionConcurrencyContext {
  readonly exercisePreparationMatrix: boolean;
  readonly terminalScenario: ScenarioTerminalScenario;
  readonly firstRunGrants: Map<string, string>;
  activeDatabaseUrl: InitialContextSuite['activeDatabaseUrl'];
  readonly runRef: Common.ObjectRef;
  readonly firstRunEntry: ReturnType<typeof createControlledFirstRunEntry>;
  submitEnvelope: ScenarioStartEnvelope;
  readonly sessionFor: InitialContextSuite['sessionFor'];
  service: Principal;
  admin: InitialContextSuite['admin'];
  readonly runDeadline: Date;
  readonly waitForDeadline: InitialContextSuite['waitForDeadline'];
  clock: InitialContextSuite['clock'];
  readonly revokeCapabilityTracked: InitialContextSuite['revokeCapabilityTracked'];
  readonly identityDeps: InitialContextSuite['identityDeps'];
  fixture: InitialContextSuite['fixture'];
  readonly receiptRows: InitialContextSuite['receiptRows'];
  readonly firstRunEnvelope: ScenarioFirstRunEnvelope;
  readonly grant: InitialContextSuite['grant'];
  readonly firstRunCodes: ScenarioFirstRunCodes;
  readonly resultTarget: Common.ObjectRef;
  readonly resultBody: Record<string, unknown>;
  readonly finalView: ScenarioFinalView;
}

export async function verifySubmissionConcurrency(
  scenarioState: VerifySubmissionConcurrencyContext,
): Promise<boolean> {
  if (
    scenarioState.exercisePreparationMatrix ||
    scenarioState.terminalScenario === 'LOCK_DEADLINE'
  ) {
    const submitGrantId = scenarioState.firstRunGrants.get('agentResultSubmitV1');
    const submitBinding = CONTROLLED_FIRST_RUN_BINDINGS.find(
      (binding) => binding.boundary === 'agentResultSubmitV1',
    );
    if (submitGrantId === undefined || submitBinding === undefined)
      throw new Error('missing Result submit Grant');
    const runBlocker = new pg.Client({ connectionString: scenarioState.activeDatabaseUrl });
    await runBlocker.connect();
    let pendingSubmit: Promise<unknown> | undefined;
    try {
      await runBlocker.query('BEGIN');
      await runBlocker.query('SELECT run_id FROM task_execution.run WHERE run_id=$1 FOR UPDATE', [
        scenarioState.runRef.objectId,
      ]);
      pendingSubmit = scenarioState.firstRunEntry
        .submitAgentResult(
          scenarioState.submitEnvelope,
          scenarioState.sessionFor(scenarioState.service),
        )
        .catch((error: unknown) => error);
      const blockerPid = definedValue(
        (await runBlocker.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0],
      ).pid;
      await expect
        .poll(
          async () =>
            (
              await scenarioState.admin.query<{ n: number }>(
                'SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',
                [blockerPid],
              )
            ).rows[0]?.n ?? 0,
          { timeout: 10_000 },
        )
        .toBeGreaterThan(0);
      if (scenarioState.terminalScenario === 'LOCK_DEADLINE') {
        const deadlineWait = Math.max(0, scenarioState.runDeadline.getTime() - Date.now() + 100);
        if (deadlineWait > 0)
          await scenarioState.waitForDeadline(deadlineWait, 'server deadline/deadlineWait');
        scenarioState.clock = Date.now();
        await runBlocker.query('ROLLBACK');
        expect(await pendingSubmit).toMatchObject({ code: 'EXECUTION_JUDGMENT_STALE' });
      } else {
        expect(
          await scenarioState.revokeCapabilityTracked(
            scenarioState.identityDeps([scenarioState.fixture.projectId]),
            {
              targetId: submitGrantId,
              expectedAggregateVersion: '1',
              scope: {
                scopeKind: 'PROJECT',
                enterpriseId: scenarioState.fixture.enterpriseId,
                projectId: scenarioState.fixture.projectId,
              },
              reasonCode: 'WI224_REVOKE_RESULT_SUBMIT_DURING_LOCK',
              effectiveAt: new Date(scenarioState.clock),
              idempotencyKey: newUuidV7(),
            },
          ),
        ).toMatchObject({ status: 'COMMITTED' });
        await runBlocker.query('ROLLBACK');
        expect(await pendingSubmit).toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
      }
    } finally {
      await runBlocker.query('ROLLBACK');
      await runBlocker.end();
      await pendingSubmit;
    }
    expect(await scenarioState.receiptRows(scenarioState.submitEnvelope.idempotencyKey)).toEqual(
      [],
    );
    if (scenarioState.terminalScenario === 'LOCK_DEADLINE') {
      expect(
        (
          await scenarioState.admin.query<{ count: string }>(
            'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
            [scenarioState.runRef.objectId],
          )
        ).rows,
      ).toEqual([{ count: '0' }]);
      const expired = await scenarioState.firstRunEntry.expireRun(
        await scenarioState.firstRunEnvelope(
          'execution.expire_run',
          scenarioState.runRef,
          { reason: 'DEADLINE_EXCEEDED' },
          scenarioState.service,
          2,
        ),
        scenarioState.sessionFor(scenarioState.service),
      );
      expect(expired).toMatchObject({ status: 'COMMITTED' });
      expect(
        (
          await scenarioState.admin.query<{ status: string }>(
            'SELECT status FROM task_execution.run WHERE run_id=$1',
            [scenarioState.runRef.objectId],
          )
        ).rows,
      ).toEqual([{ status: 'TIMED_OUT' }]);
      expect(
        (
          await scenarioState.admin.query<{ status: string }>(
            'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
            [scenarioState.runRef.objectId],
          )
        ).rows,
      ).toEqual([{ status: 'EXPIRED' }]);
      return true;
    }
    await scenarioState.grant({
      principal: scenarioState.service,
      capabilityCode: scenarioState.firstRunCodes.agentResultSubmitV1,
      action: submitBinding.requiredGrantAction,
      selectorType: submitBinding.selectorType,
      targetObjectType: 'execution.agent_result',
    });
    scenarioState.submitEnvelope = await scenarioState.firstRunEnvelope(
      'execution.submit_agent_result',
      scenarioState.resultTarget,
      {
        agentResultContract: scenarioState.resultBody,
        runFencingToken: 1,
        runtimeSubmissionRef: scenarioState.finalView.runtimeSubmissionRef,
      } as unknown as CanonicalJsonObject,
      scenarioState.service,
    );
  }
  return false;
}
