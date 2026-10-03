import { describe } from 'vitest';
import { gateEnabled } from './initial-context-fixtures.js';
import { createRunScenario } from './initial-context-scenario.js';
import { createInitialContextSuite } from './initial-context-suite.js';
import type { CancelVariant } from './initial-context-verify-run-cancellation.js';

// One registration entry preserves serial execution, fixture lifetime and
// case order against the single focused PostgreSQL database.
describe.skipIf(!gateEnabled)(
  'Human Run cancellation, lease-expiry abandonment and late-final isolation (real PostgreSQL)',
  () => {
    const suite = createInitialContextSuite();
    const runScenario = createRunScenario(suite);
    const runCancel = (variant: CancelVariant) =>
      runScenario(
        'RUN_CANCEL',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'NORMAL',
        false,
        undefined,
        variant,
      );

    suite.itIntegration(
      'CANCEL-D-002 Human cancel commits RUNNING->CANCELLING with one Intent and Receipt',
      () => runCancel({ row: 'CANCEL-D-002', bounded: true }),
      600_000,
    );
    suite.itIntegration(
      'CANCEL-D-003 lease expiry commits ABANDONED and isolates the late final',
      () => runCancel({ row: 'CANCEL-D-003', bounded: true }),
      600_000,
    );
    suite.itIntegration(
      'CANCEL-D-005 unsupported profile and premature/CANCELLING expiry refusals',
      async () => {
        // The unsupported single-attempt profile is exercised first so its
        // evidence is produced independently of the supported-path checks.
        await runCancel({ row: 'CANCEL-D-005', bounded: false, phase: 'UNSUPPORTED' });
        await runCancel({ row: 'CANCEL-D-005', bounded: true, phase: 'SUPPORTED' });
      },
      600_000,
    );
    suite.itIntegration(
      'CANCEL-D-007 Intent RLS/ACL/immutability and pre-CAS rollback',
      () => runCancel({ row: 'CANCEL-D-007', bounded: true }),
      600_000,
    );
    suite.itIntegration(
      'CANCEL-D-008 cancelling Run suspends existing Process progress without re-invoking',
      () => runCancel({ row: 'CANCEL-D-008', bounded: true }),
      600_000,
    );
  },
);
