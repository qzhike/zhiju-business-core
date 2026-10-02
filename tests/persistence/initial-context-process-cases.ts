import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { RunScenario } from './initial-context-scenario.js';
import type { InitialContextSuite } from './initial-context-suite.js';

import { createControlledFinalRecoveryWorker } from '@zhiju/api/composition';
import type { recoverControlledFinalRuns } from '@zhiju/task-execution';
import { controlledFinalProcessId } from '@zhiju/task-execution';
import { expect } from 'vitest';
import { record, type RecoveryFixture } from './initial-context-fixtures.js';
export function registerProcess(suite: InitialContextSuite, runScenario: RunScenario): void {
  suite.itIntegration(
    'recovers each committed final step after Process restart',
    () => runScenario('RECOVERY'),
    240_000,
  );
  suite.itIntegration(
    'periodically recovers the controlled final Process without overlapping ticks',
    () => runScenario('RECOVERY_WORKER'),
    240_000,
  );

  suite.itIntegration(
    'recovers two real pending Process instances with one owning command per worker tick',
    async () => {
      const fixtures: RecoveryFixture[] = [];
      for (let i = 0; i < 2; i++)
        await runScenario(
          'RECOVERY_MULTIPLE',
          'RUNTIME_USAGE',
          undefined,
          undefined,
          undefined,
          (value) => {
            fixtures.push(value);
            return Promise.resolve();
          },
        );
      const first = fixtures[0];
      if (first === undefined) throw new Error('missing first Process fixture');
      const byRun = (ref: CanonicalJsonObject) => {
        const found = fixtures.find((row) => row.runRef.objectId === ref.objectId);
        if (found === undefined) throw new Error('unknown owning Run');
        return found;
      };
      const trace: { runId: string; operation: string }[] = [];
      const errors: unknown[] = [];
      const ports: Parameters<typeof recoverControlledFinalRuns>[2] = {
        ...first.ports,
        readFinal: (ref) => {
          const found = fixtures.find((row) => row.attemptRef.objectId === ref.objectId);
          if (found === undefined) throw new Error('unknown original Attempt');
          return found.ports.readFinal(ref);
        },
        readRun: (ref) => byRun(ref).ports.readRun(ref),
        readPolicy: (ref) => {
          const found = fixtures.find((row) => row.workOrderRef.objectId === ref.objectId);
          if (found === undefined) throw new Error('unknown frozen WorkOrder');
          return found.ports.readPolicy(ref);
        },
        createProgress: (input) => byRun(input.runRef).ports.createProgress(input),
        advanceProgress: (progress, transition) =>
          byRun(progress.runRef).ports.advanceProgress(progress, transition),
        suspendTimedOutProgress: (progress) =>
          byRun(progress.runRef).ports.suspendTimedOutProgress(progress),
        execute: (command) => {
          const resultRef = command.payload.agentResultRef;
          const contract = command.payload.agentResultContract;
          const found = fixtures.find(
            (row) =>
              command.targetRef.objectId === row.runRef.objectId ||
              (resultRef !== undefined && record(resultRef).objectId === row.resultId) ||
              (contract !== undefined &&
                record(record(contract).runRef).objectId === row.runRef.objectId),
          );
          if (found === undefined) throw new Error('unknown Process source fact');
          trace.push({ runId: found.runRef.objectId, operation: command.commandType });
          return found.ports.execute(command);
        },
      };
      expect((await ports.listProgress()).map((row) => row.runRef.objectId).sort()).toEqual(
        fixtures.map((row) => row.runRef.objectId).sort(),
      );
      const worker = createControlledFinalRecoveryWorker({
        taskExecutionDb: suite.teDb,
        projects: [{ scanContext: first.scanContext, ports }],
        intervalMs: 10,
        maxStepsPerProject: 1,
        onError: (error) => {
          errors.push(error);
        },
      });
      worker.start();
      try {
        const until = Date.now() + 90_000;
        while (Date.now() < until) {
          const pending = await ports.listProgress();
          if (pending.length === 0) break;
          await new Promise<void>((resolve) => setTimeout(resolve, 25));
        }
        expect(await ports.listProgress()).toEqual([]);
      } finally {
        await worker.stop();
      }
      expect(errors).toEqual([]);
      expect(trace).toHaveLength(10);
      for (const row of fixtures) {
        expect(
          trace.filter((step) => step.runId === row.runRef.objectId).map((step) => step.operation),
        ).toEqual([
          'execution.submit_agent_result',
          'execution.record_run_result',
          'execution.validate_agent_result',
          'execution.accept_agent_result',
          'execution.finalize_run_from_acceptance',
        ]);
        expect(
          (
            await suite.admin.query<{ status: string }>(
              'SELECT status FROM task_execution.run WHERE run_id=$1',
              [row.runRef.objectId],
            )
          ).rows,
        ).toEqual([{ status: 'SUCCEEDED' }]);
        expect(
          (
            await suite.admin.query<{ status: string }>(
              'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
              [row.runRef.objectId],
            )
          ).rows,
        ).toEqual([{ status: 'RELEASED' }]);
        expect(row.driver.invokedAttemptIds).toEqual([row.attemptRef.objectId]);
        expect(
          (
            await suite.admin.query<{ count: string }>(
              "SELECT count(*)::text FROM task_execution.process_step WHERE process_id=$1 AND outcome='COMPLETED'",
              [controlledFinalProcessId(row.runRef.objectId)],
            )
          ).rows,
        ).toEqual([{ count: '5' }]);
      }
    },
    300_000,
  );

  suite.itIntegration(
    'expires a Run with a reserved Result before recovery records it',
    () => runScenario('RECOVERY_EXPIRE'),
    180_000,
  );
}
