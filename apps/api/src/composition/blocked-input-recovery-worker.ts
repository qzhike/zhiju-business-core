import {
  recoverBlockedInput,
  BLOCKED_INPUT_RECOVERY_STEPS,
  type RecoveryProcessPorts,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '@zhiju/task-execution';
import type { Kysely } from 'kysely';

import { ControlledFinalRecoveryWorker } from './controlled-final-recovery-worker.js';

export interface BlockedInputRecoveryWorkerConfig {
  readonly taskExecutionDb: Kysely<TaskExecutionDb>;
  readonly projects: readonly {
    readonly scanContext: TaskExecutionTransactionContext;
    readonly progressContext: TaskExecutionTransactionContext;
    readonly ports: RecoveryProcessPorts;
  }[];
  readonly intervalMs: number;
  readonly maxStepsPerProject?: number;
  readonly onError: (error: unknown) => void | Promise<void>;
}

/** Runs finite Project recovery passes; authenticated Human actions remain external. */
export function createBlockedInputRecoveryWorker(config: BlockedInputRecoveryWorkerConfig) {
  const maxSteps = config.maxStepsPerProject ?? BLOCKED_INPUT_RECOVERY_STEPS.length;
  if (
    !Number.isSafeInteger(maxSteps) ||
    maxSteps < 1 ||
    maxSteps > BLOCKED_INPUT_RECOVERY_STEPS.length
  ) {
    throw new TypeError('blocked input recovery step limit must be between one and thirteen');
  }
  return new ControlledFinalRecoveryWorker({
    intervalMs: config.intervalMs,
    onError: config.onError,
    recover: async () => {
      for (const project of config.projects) {
        await recoverBlockedInput(
          config.taskExecutionDb,
          project.scanContext,
          project.progressContext,
          project.ports,
          maxSteps,
        );
      }
    },
  });
}
