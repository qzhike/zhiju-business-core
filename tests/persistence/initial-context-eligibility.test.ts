import { describe } from 'vitest';
import { gateEnabled } from './initial-context-fixtures.js';
import {
  registerIsolatedInitialContextGroups,
  type IsolatedInitialContextCase,
} from './initial-context-isolated-cases.js';

describe.skipIf(!gateEnabled)('initial Context eligibility changes (isolated PostgreSQL)', () => {
  registerIsolatedInitialContextGroups(
    (['GRANT', 'POLICY'] as const).map((source) => {
      const cases: IsolatedInitialContextCase[] = [];
      for (const step of ['SUBMIT', 'RECORD', 'VALIDATE', 'ACCEPT', 'FINALIZE'] as const) {
        cases.push({
          name: `rejects ${step} after current ${source} eligibility changes and expires without renewing rights`,
          run: (_suite, runScenario) =>
            runScenario('ELIGIBILITY_CHANGE', 'RUNTIME_USAGE', undefined, undefined, {
              source,
              step,
            }),
          timeout: 180_000,
        });
      }
      const step = source === 'GRANT' ? 'ACCEPT' : 'SUBMIT';
      cases.push({
        name: `refuses ${step} when ${source} eligibility changes while the owning Run lock is held`,
        run: (_suite, runScenario) =>
          runScenario('ELIGIBILITY_CHANGE', 'RUNTIME_USAGE', undefined, undefined, {
            step,
            source,
            whileLocked: true,
          }),
        timeout: 180_000,
      });
      return { label: `eligibility ${source}`, cases };
    }),
  );
});
