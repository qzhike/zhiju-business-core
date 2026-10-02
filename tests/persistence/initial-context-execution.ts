import { describe } from 'vitest';
import { registerCompletion } from './initial-context-completion-cases.js';
import { registerDelivery } from './initial-context-delivery-cases.js';
import { registerLegacy } from './initial-context-legacy-cases.js';
import { registerMaterialRecovery } from './initial-context-material-recovery-cases.js';
import { registerProcess } from './initial-context-process-cases.js';
import { registerResultLifecycle } from './initial-context-result-lifecycle-cases.js';
import { registerResultRejection } from './initial-context-result-rejection-cases.js';
import { createRunScenario } from './initial-context-scenario.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export function registerExecution(suite: InitialContextSuite): void {
  describe('TE-VAL-S-008 first Run terminal paths', () => {
    const runScenario = createRunScenario(suite);
    registerLegacy(suite, runScenario);
    registerCompletion(suite, runScenario);
    registerMaterialRecovery(suite, runScenario);
    registerResultLifecycle(suite, runScenario);
    registerProcess(suite, runScenario);
    registerResultRejection(suite, runScenario);
    registerDelivery(suite);
  });
}
