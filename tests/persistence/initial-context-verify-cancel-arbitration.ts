import { setTimeout as delay } from 'node:timers/promises';
import { LocalSyntheticRuntimeDriver } from '@zhiju/integration-gateway';
import type { Common } from '@zhiju/contracts';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import pg from 'pg';
import { expect } from 'vitest';
import { definedValue, objectRef, record } from './initial-context-fixtures.js';
import {
  buildCancelEnvelope,
  buildExpireEnvelope,
  claimStatus,
  countWhere,
  readRunRow,
  terminatedEvents,
  type VerifyRunCancellationContext,
} from './initial-context-verify-run-cancellation.js';

/** CANCEL-D-004(a) submit/record arbitration and (b) expiry arbitration. */

/** Release the delayed original final, persist the immutable Observation and
 * commit the Result submit so the arbitration races start from a real
 * `RUNNING` Run with a committed submit but no record yet. */
async function submitCommittedFinal(state: VerifyRunCancellationContext) {
  const lateDriver = new LocalSyntheticRuntimeDriver(
    undefined,
    state.runtimeJournal,
    () => new Date(state.clock),
  );
  await lateDriver.releaseFinal(state.attemptRef);
  const finalView = await state.firstRunEntry.observeRuntimeFinal(
    await state.firstRunQuery(
      'integration.get_runtime_final_observation',
      state.attemptRef,
      { attemptRef: state.attemptRef } as unknown as CanonicalJsonObject,
      'runtimeFinalReadV1',
    ),
    state.sessionFor(state.service),
  );
  const body = record(record(finalView).agentResultContract);
  const target = objectRef(
    'execution.agent_result',
    String(body.agentResultId),
    state.scope(),
  ) as Common.ObjectRef;
  const envelope = await state.firstRunEnvelope(
    'execution.submit_agent_result',
    target,
    {
      agentResultContract: body,
      runFencingToken: 1,
      runtimeSubmissionRef: record(finalView).runtimeSubmissionRef,
    } as unknown as CanonicalJsonObject,
    state.service,
  );
  const submitted = await state.firstRunEntry.submitAgentResult(
    envelope,
    state.sessionFor(state.service),
  );
  expect(submitted, JSON.stringify(submitted)).toMatchObject({ status: 'COMMITTED' });
  return {
    resultRef: record(record(submitted).resultPayload).agentResultRef as Common.ContentAddressedRef,
  };
}

async function openRunLock(state: VerifyRunCancellationContext) {
  const blocker = new pg.Client({ connectionString: state.activeDatabaseUrl });
  await blocker.connect();
  const blockerPid = definedValue(
    (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0],
  ).pid;
  await blocker.query('BEGIN');
  await blocker.query('SELECT run_id FROM task_execution.run WHERE run_id=$1 FOR UPDATE', [
    state.runRef.objectId,
  ]);
  return { blocker, blockerPid };
}

async function waitForBlockedBackends(
  state: VerifyRunCancellationContext,
  blockerPid: number,
  expected: number,
  mode: 'blocker' | 'lock',
) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const rows = (
      await state.admin.query<{ pid: number; event: string | null; blockers: number[] }>(
        `SELECT pid, wait_event AS event, pg_blocking_pids(pid) AS blockers
           FROM pg_stat_activity WHERE wait_event_type = 'Lock'`,
      )
    ).rows;
    const observed =
      mode === 'blocker'
        ? rows.filter((row) => row.blockers.includes(blockerPid)).length
        : rows.length;
    if (observed >= expected) return;
    if (Date.now() > deadline)
      throw new Error(
        `expected ${expected} ${mode} lock waiters (blocker ${blockerPid}), saw ${observed}: ${JSON.stringify(rows)}`,
      );
    await delay(100);
  }
}

/** Both operations are launched in a fixed enqueue order behind a held Run row
 * lock, so PostgreSQL's FIFO lock queue makes the winner deterministic. The
 * blocker is always released before either outcome is awaited. */
async function raceLockedOperations(
  state: VerifyRunCancellationContext,
  first: () => Promise<unknown>,
  second: () => Promise<unknown>,
) {
  const { blocker, blockerPid } = await openRunLock(state);
  const firstOutcome = first().then(
    (value: unknown) => value,
    (error: unknown) => error,
  );
  let secondOutcome: Promise<unknown> | undefined;
  try {
    await waitForBlockedBackends(state, blockerPid, 1, 'blocker');
    secondOutcome = second().then(
      (value: unknown) => value,
      (error: unknown) => error,
    );
    await waitForBlockedBackends(state, blockerPid, 2, 'lock');
  } finally {
    await blocker.query('ROLLBACK');
    await blocker.end();
  }
  return { first: await firstOutcome, second: await secondOutcome };
}

/** CANCEL-D-004(a1): the cancel acquires the Run row lock first, so the
 * still-pending record is refused and the Run keeps no `RESULT_RECORDED`. */
async function cancelWinsOverRecord(state: VerifyRunCancellationContext): Promise<void> {
  const principal = state.operator();
  const { resultRef } = await submitCommittedFinal(state);
  const cancelEnvelope = await buildCancelEnvelope(state, principal, 2);
  const recordEnvelope = await state.firstRunEnvelope(
    'execution.record_run_result',
    state.runRef,
    { agentResultRef: resultRef } as unknown as CanonicalJsonObject,
    state.service,
    2,
  );
  const { first, second } = await raceLockedOperations(
    state,
    () => state.firstRunEntry.cancelRun(cancelEnvelope, state.sessionFor(principal)),
    () => state.firstRunEntry.recordRunResult(recordEnvelope, state.sessionFor(state.service)),
  );
  expect(first, JSON.stringify(first)).toMatchObject({ status: 'COMMITTED' });
  expect(record(first).resultPayload).toMatchObject({ status: 'CANCELLING' });
  expect(record(second).code).toBe('REFERENCE_INVALID');

  const run = await readRunRow(state);
  expect(run).toMatchObject({ status: 'CANCELLING', ended_at: null });
  expect(run.aggregate_version).toBe('3');
  const detail = (
    await state.admin.query<{ result_ref: unknown }>(
      'SELECT result_ref FROM task_execution.run WHERE run_id=$1',
      [state.runRef.objectId],
    )
  ).rows[0];
  expect(detail?.result_ref).toBeNull();
  expect(await claimStatus(state)).toBe('ACTIVE');
  expect(await state.receiptRows(recordEnvelope.idempotencyKey)).toEqual([]);
  expect(await state.receiptRows(cancelEnvelope.idempotencyKey)).toHaveLength(1);
  expect(
    await countWhere(state, 'run_cancellation_intent', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(1);
  expect(await countWhere(state, 'agent_result', 'run_id=$1', [state.runRef.objectId])).toBe(1);
  expect(await terminatedEvents(state)).toEqual([]);
  expect(
    await countWhere(state, 'run_budget_consumption', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(0);
}

/**
 * CANCEL-D-004(a2): the record acquires the Run row lock first, so the
 * concurrent cancel is refused with `AGGREGATE_STATE_NOT_ALLOWED` and leaves no
 * Intent or Receipt behind.
 */
async function recordWinsOverCancel(state: VerifyRunCancellationContext): Promise<void> {
  const principal = state.operator();
  const { resultRef } = await submitCommittedFinal(state);
  const cancelEnvelope = await buildCancelEnvelope(state, principal, 2);
  const recordEnvelope = await state.firstRunEnvelope(
    'execution.record_run_result',
    state.runRef,
    { agentResultRef: resultRef } as unknown as CanonicalJsonObject,
    state.service,
    2,
  );
  const { first, second } = await raceLockedOperations(
    state,
    () => state.firstRunEntry.recordRunResult(recordEnvelope, state.sessionFor(state.service)),
    () => state.firstRunEntry.cancelRun(cancelEnvelope, state.sessionFor(principal)),
  );
  expect(first, JSON.stringify(first)).toMatchObject({ status: 'COMMITTED' });
  expect(record(first).resultPayload).toMatchObject({ status: 'RESULT_RECORDED' });
  expect(record(second).code).toBe('AGGREGATE_STATE_NOT_ALLOWED');

  const run = await readRunRow(state);
  expect(run).toMatchObject({ status: 'RESULT_RECORDED', ended_at: null });
  expect(run.aggregate_version).toBe('3');
  const detail = (
    await state.admin.query<{ result_ref: { objectId?: string } | null }>(
      'SELECT result_ref FROM task_execution.run WHERE run_id=$1',
      [state.runRef.objectId],
    )
  ).rows[0];
  expect(detail?.result_ref?.objectId).toBe(resultRef.objectId);
  expect(await claimStatus(state)).toBe('ACTIVE');
  expect(await state.receiptRows(cancelEnvelope.idempotencyKey)).toEqual([]);
  expect(
    await countWhere(state, 'run_cancellation_intent', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(0);
  expect(await terminatedEvents(state)).toEqual([]);
  expect(
    await countWhere(state, 'run_budget_consumption', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(0);
}

/**
 * CANCEL-D-004(b1): expiry reaches the Run row lock first. Exactly one terminal
 * commits (TIMED_OUT) and the losing cancel leaves no Intent/Receipt/Event or
 * budget consumption.
 */
async function expireWinsOverCancel(state: VerifyRunCancellationContext): Promise<void> {
  const wait = Math.max(0, state.runDeadline.getTime() - Date.now() + 100);
  if (wait > 0) await state.waitForDeadline(wait, 'server deadline/cancelArbitration');
  state.clock = Date.now();

  const principal = state.operator();
  const expireEnvelope = await buildExpireEnvelope(
    state,
    state.service,
    'DEADLINE_EXCEEDED',
    '2.0',
    2,
  );
  const cancelEnvelope = await buildCancelEnvelope(state, principal, 2);
  const { first, second } = await raceLockedOperations(
    state,
    () => state.firstRunEntry.expireRun(expireEnvelope, state.sessionFor(state.service)),
    () => state.firstRunEntry.cancelRun(cancelEnvelope, state.sessionFor(principal)),
  );
  expect(first, JSON.stringify(first)).toMatchObject({ status: 'COMMITTED' });
  expect(record(first).resultPayload).toMatchObject({ status: 'TIMED_OUT' });
  expect(record(second).code).toBe('AGGREGATE_STATE_NOT_ALLOWED');

  const run = await readRunRow(state);
  expect(run).toMatchObject({
    status: 'TIMED_OUT',
    termination_reason: 'EXECUTION_DEADLINE_EXCEEDED',
  });
  expect(run.ended_at).not.toBeNull();
  expect(run.aggregate_version).toBe('3');
  expect(await claimStatus(state)).toBe('EXPIRED');
  expect(
    await countWhere(state, 'run_budget_consumption', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(1);
  const events = await terminatedEvents(state);
  expect(events).toHaveLength(1);
  expect(record(events[0]?.payload).terminalStatus).toBe('TIMED_OUT');
  expect(await state.receiptRows(cancelEnvelope.idempotencyKey)).toEqual([]);
  expect(await state.receiptRows(expireEnvelope.idempotencyKey)).toHaveLength(1);
  expect(
    await countWhere(state, 'run_cancellation_intent', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(0);
}

/**
 * CANCEL-D-004(b2): the cancel waits on the Run row lock until the original
 * lease/deadline bound has passed. The handler re-reads the trusted clock after
 * the lock and refuses with `EXECUTION_JUDGMENT_STALE` without side effects.
 */
async function cancelLockCrossesLease(state: VerifyRunCancellationContext): Promise<void> {
  const principal = state.operator();
  const cancelEnvelope = await buildCancelEnvelope(state, principal, 2);
  const { blocker, blockerPid } = await openRunLock(state);
  let pending: Promise<unknown> | undefined;
  try {
    pending = state.firstRunEntry.cancelRun(cancelEnvelope, state.sessionFor(principal)).then(
      (value: unknown) => value,
      (error: unknown) => error,
    );
    await waitForBlockedBackends(state, blockerPid, 1, 'blocker');
    const wait = Math.max(0, state.runDeadline.getTime() - Date.now() + 100);
    if (wait > 0) await state.waitForDeadline(wait, 'server deadline/cancelLeaseCross');
    state.clock = Date.now();
  } finally {
    await blocker.query('ROLLBACK');
    await blocker.end();
  }
  expect(record(await pending).code).toBe('EXECUTION_JUDGMENT_STALE');
  const run = await readRunRow(state);
  expect(run).toMatchObject({ status: 'RUNNING', ended_at: null });
  expect(run.aggregate_version).toBe('2');
  expect(await claimStatus(state)).toBe('ACTIVE');
  expect(await state.receiptRows(cancelEnvelope.idempotencyKey)).toEqual([]);
  expect(
    await countWhere(state, 'run_cancellation_intent', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(0);
  expect(await terminatedEvents(state)).toEqual([]);
  expect(
    await countWhere(state, 'run_budget_consumption', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(0);
}

/**
 * CANCEL-D-004(c): an exact terminal replay returns the original ABANDONED
 * result with no new aggregate version, outbox event or budget consumption,
 * while a conflicting same-key terminal is refused.
 */
async function replayTerminal(state: VerifyRunCancellationContext): Promise<void> {
  const principal = state.operator();
  expect(
    await state.firstRunEntry.cancelRun(
      await buildCancelEnvelope(state, principal, 2),
      state.sessionFor(principal),
    ),
  ).toMatchObject({ status: 'COMMITTED' });
  const wait = Math.max(0, state.runDeadline.getTime() - Date.now() + 100);
  if (wait > 0) await state.waitForDeadline(wait, 'server deadline/cancelReplay');
  state.clock = Date.now();

  const expireEnvelope = await buildExpireEnvelope(state, state.service, 'LEASE_EXPIRED', '2.0', 3);
  const committed = await state.firstRunEntry.expireRun(
    expireEnvelope,
    state.sessionFor(state.service),
  );
  expect(committed, JSON.stringify(committed)).toMatchObject({ status: 'COMMITTED' });
  expect(record(committed).resultPayload).toMatchObject({ status: 'ABANDONED' });

  const replay = await state.firstRunEntry.expireRun(
    expireEnvelope,
    state.sessionFor(state.service),
  );
  expect(replay).toMatchObject({ status: 'DUPLICATE', originalOutcome: 'COMMITTED' });
  expect(record(replay).resultPayload).toMatchObject({ status: 'ABANDONED' });
  const runAfterReplay = await readRunRow(state);
  expect(runAfterReplay.aggregate_version).toBe('4');
  expect(await terminatedEvents(state)).toHaveLength(1);
  expect(
    await countWhere(state, 'run_budget_consumption', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(1);

  // A same-key conflicting terminal/reason is refused before the body runs.
  const conflicting = await buildExpireEnvelope(
    state,
    state.service,
    'DEADLINE_EXCEEDED',
    '2.0',
    4,
    expireEnvelope.idempotencyKey,
  );
  const conflictError = await state.firstRunEntry
    .expireRun(conflicting, state.sessionFor(state.service))
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(record(conflictError).code).toBe('IDEMPOTENCY_PAYLOAD_CONFLICT');
  const runAfterConflict = await readRunRow(state);
  expect(runAfterConflict).toMatchObject({
    status: 'ABANDONED',
    termination_reason: 'EXECUTION_CANCELLATION_UNACKNOWLEDGED',
  });
  expect(runAfterConflict.aggregate_version).toBe('4');
  expect(await terminatedEvents(state)).toHaveLength(1);
  expect(
    await countWhere(state, 'run_budget_consumption', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(1);
  expect(await state.receiptRows(expireEnvelope.idempotencyKey)).toHaveLength(1);
}

/** CANCEL-D-004 arbitration and replay acceptance router. */
export async function verifyCancelArbitration(
  state: VerifyRunCancellationContext,
): Promise<boolean> {
  if (state.terminalScenario !== 'RUN_CANCEL') return false;
  const variant = state.cancelVariant;
  if (variant?.row !== 'CANCEL-D-004') return false;
  switch (variant.phase) {
    case 'CANCEL_WINS':
      await cancelWinsOverRecord(state);
      return true;
    case 'RECORD_WINS':
      await recordWinsOverCancel(state);
      return true;
    case 'EXPIRE_WINS':
      await expireWinsOverCancel(state);
      return true;
    case 'LEASE_CROSS':
      await cancelLockCrossesLease(state);
      return true;
    case 'REPLAY':
      await replayTerminal(state);
      return true;
    default:
      throw new Error(`CANCEL-D-004 requires an arbitration phase; got ${String(variant.phase)}`);
  }
}
