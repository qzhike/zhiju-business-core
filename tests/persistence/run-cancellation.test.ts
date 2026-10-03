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
      'CANCEL-D-004 cancel vs record_run_result: cancel wins the Run row lock first',
      () => runCancel({ row: 'CANCEL-D-004', bounded: true, phase: 'CANCEL_WINS' }),
      600_000,
    );
    suite.itIntegration(
      'CANCEL-D-004 cancel vs record_run_result: record wins the Run row lock first',
      () => runCancel({ row: 'CANCEL-D-004', bounded: true, phase: 'RECORD_WINS' }),
      600_000,
    );
    suite.itIntegration(
      'CANCEL-D-004 cancel vs expire_run@2.0: exactly one terminal wins',
      () => runCancel({ row: 'CANCEL-D-004', bounded: true, phase: 'EXPIRE_WINS' }),
      600_000,
    );
    suite.itIntegration(
      'CANCEL-D-004 cancel lock wait across the lease bound re-reads the clock and refuses',
      () => runCancel({ row: 'CANCEL-D-004', bounded: true, phase: 'LEASE_CROSS' }),
      600_000,
    );
    suite.itIntegration(
      'CANCEL-D-004 exact terminal replay is side-effect free and conflicting replay refused',
      () => runCancel({ row: 'CANCEL-D-004', bounded: true, phase: 'REPLAY' }),
      600_000,
    );
    suite.itIntegration(
      'CANCEL-D-006 each cancellation boundary gates its protected read',
      () => runCancel({ row: 'CANCEL-D-006', bounded: true, phase: 'AUTH' }),
      600_000,
    );
    suite.itIntegration(
      'CANCEL-D-006 independent cleanup authority commits with an expired Bundle',
      () => runCancel({ row: 'CANCEL-D-006', bounded: true, phase: 'CLEANUP' }),
      600_000,
    );
    suite.itIntegration(
      'CANCEL-D-006 revocation between the Run lock and commit is refused',
      () => runCancel({ row: 'CANCEL-D-006', bounded: true, phase: 'LOCK_REVOKE' }),
      600_000,
    );
    suite.itIntegration(
      'IG-CANCEL-D-001 late final aged while CANCELLING is isolated as LATE_RESULT',
      () => runCancel({ row: 'IG-CANCEL-D-001', bounded: true, phase: 'CANCELLING' }),
      600_000,
    );
    suite.itIntegration(
      'IG-CANCEL-D-001 late final aged after ABANDONED is isolated as LATE_RESULT',
      () => runCancel({ row: 'IG-CANCEL-D-001', bounded: true, phase: 'ABANDONED' }),
      600_000,
    );
    suite.itIntegration(
      'IG-CANCEL-D-002 wrong Attempt/Scope/session/hash or caller JSON never becomes LATE_RESULT',
      () => runCancel({ row: 'IG-CANCEL-D-002', bounded: true, phase: 'MISMATCH' }),
      600_000,
    );
    suite.itIntegration(
      'IG-CANCEL-D-003 Audit write failure keeps the IG source readable and retryable',
      () => runCancel({ row: 'IG-CANCEL-D-003', bounded: true, phase: 'AUDIT_FAULT' }),
      600_000,
    );
    suite.itIntegration(
      'CANCEL-D-008 cancelling Run suspends existing Process progress without re-invoking',
      () => runCancel({ row: 'CANCEL-D-008', bounded: true }),
      600_000,
    );
  },
);
