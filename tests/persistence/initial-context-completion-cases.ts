import type { RunScenario } from './initial-context-scenario.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export function registerCompletion(suite: InitialContextSuite, runScenario: RunScenario): void {
  suite.itIntegration(
    'TE-COMP-D-010 optional Quality uses exact owning selection and current eligibility',
    () => runScenario('FORMAL_QUALITY'),
    420_000,
  );

  suite.itIntegration(
    'TE-COMP-D-002 normal production formal output completes both Roots',
    () => runScenario('FORMAL_NORMAL'),
    420_000,
  );

  for (const boundary of ['GRANT_LOCK', 'DEPENDENCY_LOCK'] as const)
    suite.itIntegration(
      `TE-COMP-D-015 Completion refuses current authority revoked while waiting for parent lock ${boundary}`,
      () => runScenario(`FORMAL_${boundary}`),
      420_000,
    );

  suite.itIntegration(
    'TE-COMP-D-013 child membership wins before Completion and prevents a stale success',
    () => runScenario('FORMAL_CHILD_FIRST'),
    420_000,
  );

  suite.itIntegration(
    'TE-COMP-D-008 sealed formal output does not rescue a deadline-expired Run or late Result',
    () => runScenario('FORMAL_LATE'),
    420_000,
  );

  suite.itIntegration(
    'TE-COMP-D-004 formal empty COMPLETED remains accepted but cannot complete Roots',
    () => runScenario('FORMAL_EMPTY'),
    420_000,
  );

  suite.itIntegration(
    'TE-COMP-D-011 isolated Completion Policy successor invalidates current use',
    () => runScenario('FORMAL_POLICY'),
    420_000,
  );

  suite.itIntegration(
    'TE-COMP-D-011 isolated Completion expiry refresh preserves first completion',
    () => runScenario('FORMAL_TTL'),
    420_000,
  );

  for (const order of ['COMPLETION_FIRST', 'OPEN_FIRST'] as const)
    suite.itIntegration(
      `TE-COMP-D-013 ineligible Task Completion and actual Task/Run Request INSERT ${order}`,
      () => runScenario(`FORMAL_REQUEST_${order}`),
      420_000,
    );

  suite.itIntegration(
    'TE-COMP-D-003 recovered production formal output completes both Roots',
    () => runScenario('FORMAL_RECOVERED'),
    420_000,
  );
}
