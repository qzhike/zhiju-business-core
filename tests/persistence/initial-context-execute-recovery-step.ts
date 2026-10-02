import type { ControlledFinalRecoveryWorker } from '@zhiju/api/composition';
import {
  createBlockedInputRecoveryWorker,
  createRecoveryProcessAuthorities,
} from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import type { createRecoveryAuthorizationPort } from '@zhiju/identity-policy';
import type { CanonicalJsonObject, UuidV7 } from '@zhiju/shared-kernel';
import { digestCanonicalPayload } from '@zhiju/task-execution';
import { expect } from 'vitest';
import {
  AUTH_HASH,
  definedValue,
  objectRef,
  type Principal,
  record,
} from './initial-context-fixtures.js';
import type {
  ScenarioRecoveryConfig,
  ScenarioRecoveryVariant,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface ExecuteRecoveryStepContext {
  processPending: CanonicalJsonObject | undefined;
  processExecute: ((command: CanonicalJsonObject) => Promise<unknown>) | undefined;
  processResult: unknown;
  processWorkers: ControlledFinalRecoveryWorker[] | undefined;
  readonly exerciseRecoveryFaultMatrix: boolean;
  readonly recoveryVariant: ScenarioRecoveryVariant;
  fixture: InitialContextSuite['fixture'];
  readonly scope: InitialContextSuite['scope'];
  readonly recoveryAuth: ReturnType<typeof createRecoveryAuthorizationPort>;
  readonly identityDeps: InitialContextSuite['identityDeps'];
  service: Principal;
  readonly recoveryConfig: ScenarioRecoveryConfig;
  readonly sessionFor: InitialContextSuite['sessionFor'];
  readonly processAuthorities: Awaited<ReturnType<typeof createRecoveryProcessAuthorities>>[];
  teDb: InitialContextSuite['teDb'];
  processStep: number;
  readonly proposalId: UuidV7;
  readonly processHandoffs: Set<number>;
  admin: InitialContextSuite['admin'];
}

export async function executeRecoveryStep(
  scenarioState: ExecuteRecoveryStepContext,
  envelope: Record<string, unknown>,
  execute: (command: CanonicalJsonObject) => Promise<unknown>,
): Promise<unknown> {
  scenarioState.processPending = envelope as CanonicalJsonObject;
  scenarioState.processExecute = execute;
  scenarioState.processResult = undefined;
  if (!scenarioState.processWorkers) {
    scenarioState.processWorkers = [];
    const workerCount =
      scenarioState.exerciseRecoveryFaultMatrix ||
      ['SUSPEND', 'STALE_CONTEXT'].includes(scenarioState.recoveryVariant)
        ? 2
        : 1;
    for (let worker = 0; worker < workerCount; worker++) {
      const target = objectRef(
        'zhiju.project.project',
        scenarioState.fixture.projectId,
        scenarioState.scope(),
      ) as Common.ObjectRef;
      const decision = async (key: string, type: string, payload: CanonicalJsonObject) => {
        const result = await scenarioState.recoveryAuth.authorize(
          scenarioState.identityDeps([scenarioState.fixture.projectId], scenarioState.service),
          key,
          {
            actorSnapshotRef: scenarioState.service.actorRef,
            commandType: type,
            commandVersion: '1.0',
            commandPayloadHash: digestCanonicalPayload(payload).hash,
            authenticationContextHash: AUTH_HASH,
            targetRef: target,
          },
        );
        if (result.outcome !== 'ALLOW') throw new Error('Process authority denied');
        return result.authorizationDecisionRef;
      };
      const authorities = await createRecoveryProcessAuthorities(
        scenarioState.recoveryConfig,
        scenarioState.sessionFor(scenarioState.service),
        scenarioState.scope(),
        await decision('recoveryCandidateScanV1', 'execution.recovery.candidate.scan', {
          scopeRef: scenarioState.scope(),
        }),
        await decision('recoveryProcessProgressV1', 'execution.process.recovery_progress', {
          scopeRef: scenarioState.scope(),
          action: 'read_progress',
        }),
      );
      scenarioState.processAuthorities.push(authorities);
      scenarioState.processWorkers.push(
        createBlockedInputRecoveryWorker({
          taskExecutionDb: scenarioState.teDb,
          projects: [
            {
              ...authorities,
              ports: {
                ...authorities,
                prepareStep: (progress, key) => {
                  if (
                    progress.step !== scenarioState.processStep ||
                    progress.proposalId !== scenarioState.proposalId ||
                    !scenarioState.processPending
                  )
                    return Promise.resolve(undefined);
                  if (scenarioState.processPending.commandType !== undefined)
                    record(scenarioState.processPending).idempotencyKey = key;
                  return Promise.resolve(scenarioState.processPending);
                },
                execute: async (command) => {
                  const result = await definedValue(scenarioState.processExecute)(command);
                  if (scenarioState.processResult === undefined)
                    scenarioState.processResult = result;
                  return command.queryType === undefined
                    ? {
                        status:
                          record(result).status === 'SUCCEEDED'
                            ? 'COMMITTED'
                            : String(record(result).status),
                      }
                    : (result as CanonicalJsonObject);
                },
                afterTargetCommit: () => {
                  if (
                    scenarioState.exerciseRecoveryFaultMatrix &&
                    !scenarioState.processHandoffs.has(scenarioState.processStep)
                  ) {
                    scenarioState.processHandoffs.add(scenarioState.processStep);
                    return Promise.reject(new Error('WI231_PROGRESS_LOST'));
                  }
                  return Promise.resolve();
                },
              },
            },
          ],
          intervalMs: 1000,
          maxStepsPerProject: 1,
          onError: () => undefined,
        }),
      );
    }
  }
  if (scenarioState.exerciseRecoveryFaultMatrix)
    await expect(
      definedValue(scenarioState.processWorkers[0])
        .tick()
        .then(async () => {
          const rows = await scenarioState.admin.query(
            "SELECT state,recovery_step,blocked_reason_code FROM task_execution.process_instance WHERE process_type='blocked-input-recovery@1' AND project_id=$1",
            [scenarioState.fixture.projectId],
          );
          throw new Error(
            `Unexpected recovery wait at ${scenarioState.processStep}: ${JSON.stringify(rows.rows)}`,
          );
        }),
    ).rejects.toThrow('WI231_PROGRESS_LOST');
  await Promise.all(definedValue(scenarioState.processWorkers).map((worker) => worker.tick()));
  scenarioState.processStep++;
  scenarioState.processPending = undefined;
  return scenarioState.processResult;
}
