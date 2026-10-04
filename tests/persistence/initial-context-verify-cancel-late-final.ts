import type { Common } from '@zhiju/contracts';
import { LocalSyntheticRuntimeDriver } from '@zhiju/integration-gateway';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import { newUuidV7 } from '@zhiju/shared-kernel';
import { expect } from 'vitest';
import { objectRef, record } from './initial-context-fixtures.js';
import {
  authorizeCommand,
  buildCancelEnvelope,
  buildExpireEnvelope,
  countWhere,
  readRunRow,
  type VerifyRunCancellationContext,
} from './initial-context-verify-run-cancellation.js';

/** IG-CANCEL-D-001..003 late-final ageing, mismatch and audit-fault rows. */

async function lateFinalAudits(state: VerifyRunCancellationContext): Promise<number> {
  return (
    (
      await state.admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM task_execution.audit_record
          WHERE error_code='LATE_RESULT' AND target_id=$1`,
        [state.runRef.objectId],
      )
    ).rows[0]?.n ?? -1
  );
}

async function releaseAndObserveFinal(state: VerifyRunCancellationContext) {
  const lateDriver = new LocalSyntheticRuntimeDriver(
    undefined,
    state.runtimeJournal,
    () => new Date(state.clock),
  );
  await lateDriver.releaseFinal(state.attemptRef);
  return state.firstRunEntry.observeRuntimeFinal(
    await state.firstRunQuery(
      'integration.get_runtime_final_observation',
      state.attemptRef,
      { attemptRef: state.attemptRef } as unknown as CanonicalJsonObject,
      'runtimeFinalReadV1',
    ),
    state.sessionFor(state.service),
  );
}

async function isolationDecisionFor(
  state: VerifyRunCancellationContext,
  requestedAt: string,
  attemptRef: Common.ObjectRef,
  runRef: Common.ObjectRef,
) {
  return authorizeCommand(
    state,
    'runLateFinalIsolateV1',
    state.service,
    'execution.run.late_final.isolate',
    '1.0',
    { runRef, attemptRef, requestedAt } as unknown as CanonicalJsonObject,
    runRef,
  );
}

function isolationRequest(
  state: VerifyRunCancellationContext,
  decisionRef: Common.ContentAddressedRef,
  requestedAt: string,
) {
  return {
    runRef: state.runRef,
    attemptRef: state.attemptRef,
    authorizationDecisionRef: decisionRef,
    correlationId: newUuidV7(),
    requestedAt,
  };
}

/** IG-CANCEL-D-001: the persisted final is aged out while RUNNING progress is
 * already cancelled (CANCELLING) or abandoned. */
async function ageingOrder(state: VerifyRunCancellationContext, abandoned: boolean): Promise<void> {
  const operator = state.operator();
  expect(
    await state.firstRunEntry.cancelRun(
      await buildCancelEnvelope(state, operator, 2),
      state.sessionFor(operator),
    ),
  ).toMatchObject({ status: 'COMMITTED' });
  if (abandoned) {
    const wait = Math.max(0, state.runDeadline.getTime() - Date.now() + 100);
    if (wait > 0) await state.waitForDeadline(wait, 'server deadline/lateFinalAgeing');
    state.clock = Date.now();
    const expired = await state.firstRunEntry.expireRun(
      await buildExpireEnvelope(state, state.service, 'LEASE_EXPIRED', '2.0', 3),
      state.sessionFor(state.service),
    );
    expect(expired).toMatchObject({ status: 'COMMITTED' });
  }
  const expectedRun = await readRunRow(state);
  expect(expectedRun.status).toBe(abandoned ? 'ABANDONED' : 'CANCELLING');

  const finalView = await releaseAndObserveFinal(state);
  const observationRef = record(record(finalView).observationRef);
  // The final is readable through its original identity while the Run is not
  // eligible for a Result.
  expect(record(record(finalView).runRef).objectId).toBe(state.runRef.objectId);

  await state.usageProbe?.('CANCELLED', state.runRef);
  const requestedAt = new Date(state.clock).toISOString();
  const decision = await isolationDecisionFor(state, requestedAt, state.attemptRef, state.runRef);
  const isolated = (await state.firstRunEntry.isolateLateFinal(
    {
      runRef: state.runRef,
      attemptRef: state.attemptRef,
      authorizationDecisionRef: decision.authorizationDecisionRef,
      correlationId: newUuidV7(),
      requestedAt,
    },
    state.sessionFor(state.service),
  )) as unknown as { auditId: string; observationRef: CanonicalJsonObject; runId: string };
  expect(isolated.runId).toBe(state.runRef.objectId);
  expect(isolated.observationRef).toEqual(observationRef);
  const audit = (
    await state.admin.query<{
      outcome: string;
      error_code: string;
      runtime_ref: { observationRef: unknown };
    }>(
      `SELECT outcome, error_code, runtime_ref FROM task_execution.audit_record WHERE audit_id=$1`,
      [isolated.auditId],
    )
  ).rows[0];
  expect(audit).toMatchObject({ outcome: 'REJECTED', error_code: 'LATE_RESULT' });
  expect(record(audit?.runtime_ref).observationRef).toEqual(observationRef);
  expect(await lateFinalAudits(state)).toBe(1);
  await state.usageProbe?.('ISOLATED', state.runRef);
  expect(await countWhere(state, 'agent_result', 'run_id=$1', [state.runRef.objectId])).toBe(0);
  expect(
    await countWhere(state, 'agent_result_acceptance', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(0);
  const after = await readRunRow(state);
  expect(after.status).toBe(abandoned ? 'ABANDONED' : 'CANCELLING');
  expect(after.aggregate_version).toBe(abandoned ? '4' : '3');
}

/** IG-CANCEL-D-002: a wrong Attempt/Scope/session/payload or caller JSON must
 * never become a valid LATE_RESULT. */
async function mismatchIsolation(state: VerifyRunCancellationContext): Promise<void> {
  const operator = state.operator();
  expect(
    await state.firstRunEntry.cancelRun(
      await buildCancelEnvelope(state, operator, 2),
      state.sessionFor(operator),
    ),
  ).toMatchObject({ status: 'COMMITTED' });
  await releaseAndObserveFinal(state);

  const requestedAt = new Date(state.clock).toISOString();
  const decision = await isolationDecisionFor(state, requestedAt, state.attemptRef, state.runRef);
  const decisionRef = decision.authorizationDecisionRef;

  const wrongAttempt = objectRef(
    'integration.runtime_attempt',
    newUuidV7(),
    state.scope(),
  ) as Common.ObjectRef;
  const wrongRun = objectRef('execution.run', newUuidV7(), state.scope()) as Common.ObjectRef;

  for (const [label, request, session] of [
    [
      'wrong Attempt',
      {
        runRef: state.runRef,
        attemptRef: wrongAttempt,
        authorizationDecisionRef: decisionRef,
        correlationId: newUuidV7(),
        requestedAt: new Date(state.clock).toISOString(),
      },
      state.sessionFor(state.service),
    ],
    [
      'wrong Run Scope',
      {
        runRef: wrongRun,
        attemptRef: state.attemptRef,
        authorizationDecisionRef: decisionRef,
        correlationId: newUuidV7(),
        requestedAt: new Date(state.clock).toISOString(),
      },
      state.sessionFor(state.service),
    ],
    [
      'wrong session',
      {
        runRef: state.runRef,
        attemptRef: state.attemptRef,
        authorizationDecisionRef: decisionRef,
        correlationId: newUuidV7(),
        requestedAt: new Date(state.clock).toISOString(),
      },
      state.sessionFor(operator),
    ],
    [
      'wrong payload hash',
      {
        runRef: state.runRef,
        attemptRef: state.attemptRef,
        authorizationDecisionRef: decisionRef,
        correlationId: newUuidV7(),
        requestedAt: new Date(new Date(state.clock).getTime() + 5_000).toISOString(),
      },
      state.sessionFor(state.service),
    ],
    [
      'missing caller JSON',
      { runRef: state.runRef, authorizationDecisionRef: decisionRef, correlationId: newUuidV7() },
      state.sessionFor(state.service),
    ],
  ] as const) {
    const error = await state.firstRunEntry.isolateLateFinal(request, session).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(typeof record(error).code, label).toBe('string');
  }
  expect(await lateFinalAudits(state), 'no invalid isolation audit').toBe(0);
  expect(await countWhere(state, 'agent_result', 'run_id=$1', [state.runRef.objectId])).toBe(0);
  expect((await readRunRow(state)).status).toBe('CANCELLING');

  // The canonical request still isolates, proving the negatives were refused
  // for their own reason rather than the path being unavailable.
  const isolated = (await state.firstRunEntry.isolateLateFinal(
    {
      runRef: state.runRef,
      attemptRef: state.attemptRef,
      authorizationDecisionRef: decisionRef,
      correlationId: newUuidV7(),
      requestedAt,
    },
    state.sessionFor(state.service),
  )) as unknown as { auditId: string };
  expect(isolated.auditId).toBeDefined();
  expect(await lateFinalAudits(state)).toBe(1);
}

/** IG-CANCEL-D-003: an Audit write failure keeps the immutable IG source
 * readable and retryable by its original identity without re-invoking the
 * Driver. */
async function auditFaultRetry(state: VerifyRunCancellationContext): Promise<void> {
  const operator = state.operator();
  expect(
    await state.firstRunEntry.cancelRun(
      await buildCancelEnvelope(state, operator, 2),
      state.sessionFor(operator),
    ),
  ).toMatchObject({ status: 'COMMITTED' });
  const finalView = await releaseAndObserveFinal(state);
  const observationRef = record(record(finalView).observationRef);
  const invocationsBefore = [...state.runtimeDriver.invokedAttemptIds];

  const requestedAt = new Date(state.clock).toISOString();
  const decision = await isolationDecisionFor(state, requestedAt, state.attemptRef, state.runRef);
  const request = isolationRequest(state, decision.authorizationDecisionRef, requestedAt);

  const faultTrigger = 'wi244_audit_fault';
  await state.admin.query(
    `CREATE FUNCTION task_execution.${faultTrigger}() RETURNS trigger
       LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'WI244_AUDIT_FAULT'; END $f$`,
  );
  await state.admin.query(
    `CREATE TRIGGER ${faultTrigger} BEFORE INSERT ON task_execution.audit_record
       FOR EACH ROW WHEN (NEW.error_code = 'LATE_RESULT')
       EXECUTE FUNCTION task_execution.${faultTrigger}()`,
  );
  try {
    await expect(
      state.firstRunEntry.isolateLateFinal(request, state.sessionFor(state.service)),
    ).rejects.toThrow(/WI244_AUDIT_FAULT/);
  } finally {
    await state.admin.query(
      `DROP TRIGGER IF EXISTS ${faultTrigger} ON task_execution.audit_record`,
    );
    await state.admin.query(`DROP FUNCTION IF EXISTS task_execution.${faultTrigger}()`);
  }

  // The immutable IG source stays readable by its original identity.
  expect(await lateFinalAudits(state)).toBe(0);
  const reread = await state.firstRunEntry.getRuntimeFinalObservation(
    await state.firstRunQuery(
      'integration.get_runtime_final_observation',
      state.attemptRef,
      { attemptRef: state.attemptRef } as unknown as CanonicalJsonObject,
      'runtimeFinalReadV1',
    ),
    state.sessionFor(state.service),
  );
  expect(record(reread).observationRef).toEqual(observationRef);
  const journalDriver = new LocalSyntheticRuntimeDriver(
    undefined,
    state.runtimeJournal,
    () => new Date(state.clock),
  );
  const rawFinal = await journalDriver.readFinal(state.attemptRef);
  expect(record(record(rawFinal).agentResultContract).agentResultId).toBe(
    record(record(finalView).agentResultContract).agentResultId,
  );
  expect(state.runtimeDriver.invokedAttemptIds).toEqual(invocationsBefore);

  // The retry commits the same observation by its original identity.
  const retried = (await state.firstRunEntry.isolateLateFinal(
    request,
    state.sessionFor(state.service),
  )) as unknown as { observationRef: CanonicalJsonObject };
  expect(retried.observationRef).toEqual(observationRef);
  expect(await lateFinalAudits(state)).toBe(1);
  expect(state.runtimeDriver.invokedAttemptIds).toEqual(invocationsBefore);
  expect(await countWhere(state, 'agent_result', 'run_id=$1', [state.runRef.objectId])).toBe(0);
  expect((await readRunRow(state)).status).toBe('CANCELLING');
}

/** IG-CANCEL-D-001..003 late-final acceptance router. */
export async function verifyCancelLateFinal(state: VerifyRunCancellationContext): Promise<boolean> {
  if (state.terminalScenario !== 'RUN_CANCEL') return false;
  const variant = state.cancelVariant;
  if (variant?.row.startsWith('IG-CANCEL-D-') !== true) return false;
  switch (variant.phase) {
    case 'CANCELLING':
      await ageingOrder(state, false);
      return true;
    case 'ABANDONED':
      await ageingOrder(state, true);
      return true;
    case 'MISMATCH':
      await mismatchIsolation(state);
      return true;
    case 'AUDIT_FAULT':
      await auditFaultRetry(state);
      return true;
    default:
      throw new Error(`IG-CANCEL-D requires a late-final phase; got ${String(variant.phase)}`);
  }
}
