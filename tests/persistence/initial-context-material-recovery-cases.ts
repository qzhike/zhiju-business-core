import type { RunScenario } from './initial-context-scenario.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export function registerMaterialRecovery(
  suite: InitialContextSuite,
  runScenario: RunScenario,
): void {
  suite.itIntegration(
    'TE-REC-D-001 bounded BLOCKED_INPUT Human recovery reaches two SUCCEEDED Runs and COMPLETION_PENDING',
    () => runScenario('BOUNDED_RECOVERY'),
    420_000,
  );

  suite.itIntegration(
    'TE-REC-D-010 suspends real recovery workers after current build Grant revocation',
    async () => {
      await runScenario(
        'BOUNDED_RECOVERY',
        'RUNTIME_USAGE',
        undefined,
        undefined,
        undefined,
        undefined,
        'SUSPEND',
      );
    },
    420_000,
  );

  suite.itIntegration(
    'TE-REC-D-010 preserves expired Context and saved Process bytes while independently building a new identity',
    () =>
      runScenario(
        'BOUNDED_RECOVERY',
        'RUNTIME_USAGE',
        undefined,
        undefined,
        undefined,
        undefined,
        'STALE_CONTEXT',
      ),
    420_000,
  );

  for (const variant of [
    'REQUEST_EXPIRED',
    'CONTROLS_SUPERSEDED',
    'BUILDER_SUPERSEDED',
    'OTHER_CHILD',
    'BUDGET_EXHAUSTED',
    'EXPIRE_SOURCE',
    'SECOND_WRONG_SESSION',
    'SECOND_EXPIRY_RACE',
  ] as const)
    suite.itIntegration(
      `TE-REC-D-005/007/010 validates bounded recovery variant ${variant}`,
      () =>
        runScenario(
          'BOUNDED_RECOVERY',
          'RUNTIME_USAGE',
          undefined,
          undefined,
          undefined,
          undefined,
          variant,
        ),
      420_000,
    );

  for (const [variant, outcome] of [
    ['SECOND_BLOCKED', 'BLOCKED_INPUT'],
    ['SECOND_PARTIAL', 'PARTIAL'],
    ['SECOND_FAILED', 'FAILED_EXECUTION'],
  ] as const)
    suite.itIntegration(
      `TE-REC-D-009 refuses actual Run-2 ${outcome} final without reserving a Result or creating a third Run`,
      () =>
        runScenario(
          'BOUNDED_RECOVERY',
          'RUNTIME_USAGE',
          undefined,
          undefined,
          undefined,
          undefined,
          variant,
        ),
      420_000,
    );
}
