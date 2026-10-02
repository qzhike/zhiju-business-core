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

  for (const negativeFinalCase of [
    'RUNTIME_USAGE',
    'OUTCOME',
    'BUSINESS_OUTPUT',
    'ARTIFACT_ALIAS',
    'WORKSPACE_OUTPUT',
    'FINDING',
    'KNOWLEDGE_PROPOSAL',
    'INPUT_REQUEST_PROPOSAL',
    'FOLLOW_UP_PROPOSAL',
    'CONTINUATION',
    'HEADER',
    'PROVENANCE',
    'TIME',
  ] as const)
    suite.itIntegration(
      `rejects Core-valid unsupported final ${negativeFinalCase} without reserving a Result`,
      () => runScenario('UNSUPPORTED_FINAL', negativeFinalCase),
      180_000,
    );

  suite.itIntegration(
    'rejects a non-final Result at the Core contract boundary before IG observation',
    () => runScenario('NON_FINAL_CORE_REJECT'),
    180_000,
  );
}
