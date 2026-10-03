import type { createControlledFirstRunEntry } from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  type CommandResult,
  controlledFinalProcessId,
  createControlledFinalProgress,
  listControlledFinalProgress,
  recoverControlledFinalRuns,
  suspendTimedOutControlledFinalProgress,
  type TaskExecutionDb,
} from '@zhiju/task-execution';
import type { Kysely } from 'kysely';
import { expect } from 'vitest';
import { objectRef, type Principal, record } from './initial-context-fixtures.js';
import type {
  ScenarioFinalView,
  ScenarioFirstRunEnvelope,
  ScenarioFirstRunQuery,
  ScenarioProgressAuthorization,
  ScenarioProgressEnvelope,
  ScenarioProgressListAuthorization,
  ScenarioScanContext,
  ScenarioTerminalScenario,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifyRecoveryExpiryContext {
  readonly terminalScenario: ScenarioTerminalScenario;
  readonly runRef: Common.ObjectRef;
  readonly attemptRef: Common.ObjectRef;
  readonly finalView: ScenarioFinalView;
  readonly controlsRef: Common.VersionedRef;
  readonly progressAuthorization: ScenarioProgressAuthorization;
  readonly guardedTeDb: Kysely<TaskExecutionDb>;
  readonly scanContext: ScenarioScanContext;
  readonly progressEnvelope: ScenarioProgressEnvelope;
  clock: InitialContextSuite['clock'];
  readonly scanProof: () => Promise<void>;
  readonly scope: InitialContextSuite['scope'];
  readonly restartedEntry: ReturnType<typeof createControlledFirstRunEntry>;
  readonly firstRunEnvelope: ScenarioFirstRunEnvelope;
  service: Principal;
  readonly sessionFor: InitialContextSuite['sessionFor'];
  readonly committedPayload: InitialContextSuite['committedPayload'];
  readonly runDeadline: Date;
  readonly waitForDeadline: InitialContextSuite['waitForDeadline'];
  readonly firstRunQuery: ScenarioFirstRunQuery;
  admin: InitialContextSuite['admin'];
  teDb: InitialContextSuite['teDb'];
  progressListAuthorization: ScenarioProgressListAuthorization;
}

export async function verifyRecoveryExpiry(
  scenarioState: VerifyRecoveryExpiryContext,
): Promise<boolean> {
  if (scenarioState.terminalScenario === 'RECOVERY_EXPIRE') {
    const progressPayload = {
      runRef: scenarioState.runRef,
      attemptRef: scenarioState.attemptRef,
      sourceRef: scenarioState.finalView.observationRef,
      policyRef: scenarioState.controlsRef,
      runVersion: '2',
    } as unknown as CanonicalJsonObject;
    const progressCreation = await scenarioState.progressAuthorization(progressPayload);
    const observationHash = record(
      record(scenarioState.finalView.observationRef).contentHash,
    ).digest;
    if (typeof observationHash !== 'string') throw new Error('missing final observation Hash');
    expect(
      await createControlledFinalProgress(
        scenarioState.guardedTeDb,
        progressCreation.context,
        scenarioState.scanContext,
        scenarioState.progressEnvelope(
          progressCreation.context,
          controlledFinalProcessId(scenarioState.runRef.objectId),
          progressPayload,
          `controlled-final:create:${scenarioState.runRef.objectId}:${observationHash}`,
        ),
        () => new Date(scenarioState.clock),
        progressCreation.proof,
        scenarioState.scanProof,
      ),
    ).toMatchObject({ status: 'COMMITTED' });
    const resultBody = record(scenarioState.finalView.agentResultContract);
    const resultTarget = objectRef(
      'execution.agent_result',
      String(resultBody.agentResultId),
      scenarioState.scope(),
    ) as Common.ObjectRef;
    const submitted = await scenarioState.restartedEntry.submitAgentResult(
      await scenarioState.firstRunEnvelope(
        'execution.submit_agent_result',
        resultTarget,
        {
          agentResultContract: resultBody,
          runFencingToken: 1,
          runtimeSubmissionRef: scenarioState.finalView.runtimeSubmissionRef,
        } as unknown as CanonicalJsonObject,
        scenarioState.service,
      ),
      scenarioState.sessionFor(scenarioState.service),
    );
    expect(submitted, JSON.stringify(submitted)).toMatchObject({ status: 'COMMITTED' });
    const resultRef = record(scenarioState.committedPayload(submitted as CommandResult))
      .agentResultRef as Common.ContentAddressedRef;
    const deadlineWait = Math.max(0, scenarioState.runDeadline.getTime() - Date.now() + 100);
    if (deadlineWait > 0)
      await scenarioState.waitForDeadline(deadlineWait, 'server deadline/deadlineWait');
    scenarioState.clock = Date.now();
    await expect(
      scenarioState.restartedEntry.recordRunResult(
        await scenarioState.firstRunEnvelope(
          'execution.record_run_result',
          scenarioState.runRef,
          { agentResultRef: resultRef } as unknown as CanonicalJsonObject,
          scenarioState.service,
          2,
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).rejects.toMatchObject({ code: 'EXECUTION_JUDGMENT_STALE' });
    expect(
      await scenarioState.restartedEntry.expireRun(
        await scenarioState.firstRunEnvelope(
          'execution.expire_run',
          scenarioState.runRef,
          { reason: 'DEADLINE_EXCEEDED' },
          scenarioState.service,
          2,
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({ status: 'COMMITTED' });
    expect(
      await scenarioState.restartedEntry.getRunState(
        await scenarioState.firstRunQuery(
          'execution.get_run_state',
          scenarioState.runRef,
          { runRef: scenarioState.runRef } as unknown as CanonicalJsonObject,
          'runStateReadV1',
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({ status: 'TIMED_OUT', terminationReason: 'EXECUTION_DEADLINE_EXCEEDED' });
    expect(
      (
        await scenarioState.admin.query<{ status: string }>(
          'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
          [scenarioState.runRef.objectId],
        )
      ).rows,
    ).toEqual([{ status: 'EXPIRED' }]);
    expect(
      (
        await scenarioState.admin.query<{ count: string }>(
          'SELECT count(*)::text FROM task_execution.agent_result_acceptance WHERE result_id=$1',
          [resultTarget.objectId],
        )
      ).rows,
    ).toEqual([{ count: '0' }]);
    const readExpiredRun = async (currentRunRef: CanonicalJsonObject) =>
      scenarioState.restartedEntry.getRunState(
        await scenarioState.firstRunQuery(
          'execution.get_run_state',
          currentRunRef as unknown as Common.ObjectRef,
          { runRef: currentRunRef },
          'runStateReadV1',
        ),
        scenarioState.sessionFor(scenarioState.service),
      );
    expect(
      await recoverControlledFinalRuns(scenarioState.teDb, scenarioState.scanContext, {
        now: () => new Date(scenarioState.clock),
        revalidateScan: scenarioState.scanProof,
        readFinal: () => Promise.reject(new Error('timed-out Process must not query IG')),
        readRun: async (currentRunRef) => {
          const state = await readExpiredRun(currentRunRef);
          return state;
        },
        readPolicy: () => Promise.reject(new Error('timed-out Process must not read Policy')),
        listProgress: () =>
          listControlledFinalProgress(
            scenarioState.guardedTeDb,
            scenarioState.progressListAuthorization.context,
            scenarioState.progressListAuthorization.proof,
          ),
        createProgress: () => Promise.reject(new Error('timed-out Process must not be recreated')),
        advanceProgress: () =>
          Promise.reject(new Error('timed-out Process must not advance owning steps')),
        suspendTimedOutProgress: async (
          progress,
          observedStatus: 'TIMED_OUT' | 'CANCELLING' | 'ABANDONED',
        ) => {
          const payload = {
            runRef: progress.runRef,
            sourceRef: progress.sourceRef,
            step: progress.step,
            observedStatus,
          } as CanonicalJsonObject;
          const authorized = await scenarioState.progressAuthorization(payload);
          expect(
            await suspendTimedOutControlledFinalProgress(
              scenarioState.teDb,
              authorized.context,
              scenarioState.progressEnvelope(
                authorized.context,
                progress.processId,
                payload,
                `controlled-final:suspend:${progress.processId}:${progress.aggregateVersion}`,
                progress.aggregateVersion,
              ),
              progress,
              async (currentRunRef) => (await readExpiredRun(currentRunRef)).status,
              authorized.proof,
              observedStatus,
            ),
          ).toMatchObject({ status: 'COMMITTED' });
        },
        execute: () => Promise.reject(new Error('timed-out Process must not execute')),
      }),
    ).toBe(0);
    expect(
      (
        await scenarioState.admin.query<{ state: string; blocked_reason_code: string }>(
          'SELECT state,blocked_reason_code FROM task_execution.process_instance WHERE process_id=$1',
          [controlledFinalProcessId(scenarioState.runRef.objectId)],
        )
      ).rows,
    ).toEqual([{ state: 'SUSPENDED', blocked_reason_code: 'RUN_TIMED_OUT' }]);
    return true;
  }
  return false;
}
