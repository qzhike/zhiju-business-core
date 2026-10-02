import type { RunScenario } from './initial-context-scenario.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export function registerResultRejection(
  suite: InitialContextSuite,
  runScenario: RunScenario,
): void {
  suite.itIntegration(
    'rejects Acceptance after its Validation Bundle and Run deadline expire',
    () => runScenario('VALIDATION_EXPIRED'),
    180_000,
  );

  suite.itIntegration(
    'rejects a non-final Result at the Core contract boundary before IG observation',
    () => runScenario('NON_FINAL_CORE_REJECT'),
    180_000,
  );
}
