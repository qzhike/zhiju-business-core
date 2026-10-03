import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe } from 'vitest';
import { postgresImageReference } from '../../tools/persistence/baseline.mjs';
import { runFlyway } from '../../tools/persistence/flyway.mjs';
import { definedValue, gateEnabled } from './initial-context-fixtures.js';
import { createRunScenario } from './initial-context-scenario.js';
import { createInitialContextSuite } from './initial-context-suite.js';
import type { CancelVariant } from './initial-context-verify-run-cancellation.js';

// The seeded enterprise/principal fixture set is per database, so this file
// owns an isolated PostgreSQL container instead of sharing the gate database
// with tests/persistence/initial-context.test.ts. One registration entry still
// preserves serial execution, fixture lifetime and case order.
const container: StartedPostgreSqlContainer | undefined = gateEnabled
  ? await new PostgreSqlContainer(postgresImageReference())
      .withDatabase('zhiju_core')
      .withUsername('postgres')
      .withPassword('zhiju-gate-test')
      .withStartupTimeout(120_000)
      .start()
  : undefined;

beforeAll(async () => {
  await runFlyway(definedValue(container).getId(), {
    command: 'migrate',
    database: 'zhiju_core',
    username: 'postgres',
    password: 'zhiju-gate-test',
  });
}, 600_000);

afterAll(async () => {
  await container?.stop();
}, 120_000);

describe.skipIf(!gateEnabled)(
  'Human Run cancellation, lease-expiry abandonment and late-final isolation (isolated PostgreSQL)',
  () => {
    const databaseUrl = container?.getConnectionUri();
    const suite = createInitialContextSuite(databaseUrl === undefined ? {} : { databaseUrl });
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
    suite.itIntegration(
      'CANCEL-D-006 read-then-revoke dependency authority leaves no LATE_RESULT Audit',
      () => runCancel({ row: 'CANCEL-D-006', bounded: true, phase: 'DEP_REVOKE' }),
      600_000,
    );
    suite.itIntegration(
      'CANCEL-D-007 a forged Intent candidate rolls back the whole cancellation',
      () => runCancel({ row: 'CANCEL-D-007', bounded: true, phase: 'INTENT_FORGERY' }),
      600_000,
    );
    suite.itIntegration(
      'CANCEL-D-005 late isolation accepts only the supported profile with its reservation',
      async () => {
        await runCancel({ row: 'CANCEL-D-005', bounded: true, phase: 'PROFILE_BOUND' });
        await runCancel({ row: 'CANCEL-D-005', bounded: false, phase: 'PROFILE_BOUND' });
      },
      900_000,
    );
  },
);
