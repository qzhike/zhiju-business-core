import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { RunScenario } from './initial-context-scenario.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export function registerResultLifecycle(
  suite: InitialContextSuite,
  runScenario: RunScenario,
): void {
  suite.itIntegration(
    'completes Validation, Freeze and SUCCEEDED Run',
    () => runScenario('SUCCEEDED'),
    420_000,
  );

  suite.itIntegration(
    'rejects mixed validations from two real owning Run Bundles',
    async () => {
      let first: CanonicalJsonObject | undefined;
      await runScenario('MIX_VALIDATIONS', 'RUNTIME_USAGE', undefined, (value) => {
        first = value;
      });
      if (first === undefined) throw new Error('missing first owning validation Bundle');
      await runScenario('MIX_VALIDATIONS', 'RUNTIME_USAGE', first);
    },
    360_000,
  );

  suite.itIntegration(
    'serializes two owning accept commands with different Acceptance targets',
    () => runScenario('ACCEPT_RACE'),
    240_000,
  );

  for (const source of ['GRANT', 'POLICY'] as const)
    for (const step of ['SUBMIT', 'RECORD', 'VALIDATE', 'ACCEPT', 'FINALIZE'] as const)
      suite.itIntegration(
        `rejects ${step} after current ${source} eligibility changes and expires without renewing rights`,
        () =>
          runScenario('ELIGIBILITY_CHANGE', 'RUNTIME_USAGE', undefined, undefined, {
            source,
            step,
          }),
        180_000,
      );

  for (const [step, source] of [
    ['SUBMIT', 'POLICY'],
    ['ACCEPT', 'GRANT'],
  ] as const)
    suite.itIntegration(
      `refuses ${step} when ${source} eligibility changes while the owning Run lock is held`,
      () =>
        runScenario('ELIGIBILITY_CHANGE', 'RUNTIME_USAGE', undefined, undefined, {
          step,
          source,
          whileLocked: true,
        }),
      180_000,
    );

  suite.itIntegration(
    'expires a Run after a late synthetic final',
    () => runScenario('TIMED_OUT'),
    180_000,
  );

  suite.itIntegration(
    'preserves the original late IG final after TE has already expired the Run',
    () => runScenario('TERMINAL_BEFORE_FINAL'),
    180_000,
  );

  suite.itIntegration(
    'rejects a Core-valid Driver final whose session differs from the original ack',
    () => runScenario('IG_WRONG_SESSION'),
    180_000,
  );

  suite.itIntegration(
    'expires a Run after its execution Bundle expires under independent monitor authorization',
    () => runScenario('TIMED_OUT_BUNDLE_EXPIRED'),
    180_000,
  );

  suite.itIntegration(
    'serializes concurrent finalize and expire after the deadline',
    () => runScenario('RACE'),
    240_000,
  );

  suite.itIntegration(
    'rejects Result submit when the Run deadline passes during its row-lock wait',
    () => runScenario('LOCK_DEADLINE'),
    180_000,
  );
}
