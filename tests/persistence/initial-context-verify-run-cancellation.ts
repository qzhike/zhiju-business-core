import type { Common } from '@zhiju/contracts';
import type { createControlledFirstRunEntry } from '@zhiju/api/composition';
import { LocalSyntheticRuntimeDriver } from '@zhiju/integration-gateway';
import { type CanonicalJsonObject, newUuidV7 } from '@zhiju/shared-kernel';
import {
  controlledFinalProcessId,
  createControlledFinalProgress,
  type ControlledFinalProgress,
  digestCanonicalPayload,
  listControlledFinalProgress,
  recoverControlledFinalRuns,
  suspendTimedOutControlledFinalProgress,
  type TaskExecutionDb,
} from '@zhiju/task-execution';
import type { Kysely } from 'kysely';
import { expect } from 'vitest';
import {
  contentHash,
  objectRef,
  PRINCIPAL_OBJECT,
  type Principal,
  record,
} from './initial-context-fixtures.js';
import type {
  ScenarioProgressAuthorization,
  ScenarioProgressEnvelope,
  ScenarioProgressListAuthorization,
  ScenarioScanContext,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
import type { VerifyTerminalExpiryContext } from './initial-context-verify-terminal-expiry.js';

/** #244 acceptance rows, one per focused itIntegration case. */
export type CancelAcceptanceRow =
  | 'CANCEL-D-002'
  | 'CANCEL-D-003'
  | 'CANCEL-D-004'
  | 'CANCEL-D-005'
  | 'CANCEL-D-006'
  | 'CANCEL-D-007'
  | 'CANCEL-D-008'
  | 'IG-CANCEL-D-001'
  | 'IG-CANCEL-D-002'
  | 'IG-CANCEL-D-003';

/** CANCEL-D-004 arbitration and replay sub-schedules. */
export type CancelArbitrationPhase =
  'CANCEL_WINS' | 'RECORD_WINS' | 'EXPIRE_WINS' | 'LEASE_CROSS' | 'REPLAY';

/** CANCEL-D-006 independent-authorization sub-schedules. */
export type CancelAuthorizationPhase = 'AUTH' | 'CLEANUP' | 'LOCK_REVOKE';

/** IG-CANCEL-D-001..003 late-final isolation sub-schedules. */
export type CancelLateFinalPhase = 'CANCELLING' | 'ABANDONED' | 'MISMATCH' | 'AUDIT_FAULT';

export type CancelPhase =
  | 'SUPPORTED'
  | 'UNSUPPORTED'
  | CancelArbitrationPhase
  | CancelAuthorizationPhase
  | CancelLateFinalPhase
  // PR #245 review-fix negatives (F1/F2/F3).
  | 'DEP_REVOKE'
  | 'INTENT_FORGERY'
  | 'PROFILE_BOUND';

/**
 * Per-invocation discriminator. `bounded` selects the two-attempt Controls
 * @1.1 profile with a real creation-time reservation (supported cancel path)
 * versus the single-attempt profile used as the CANCEL-D-005 negative.
 */
export interface CancelVariant {
  readonly row: CancelAcceptanceRow;
  readonly bounded: boolean;
  readonly phase?: CancelPhase;
}

export interface VerifyRunCancellationContext extends VerifyTerminalExpiryContext {
  readonly cancelVariant: CancelVariant | undefined;
  readonly operator: InitialContextSuite['operator'];
  readonly teDb: InitialContextSuite['teDb'];
  readonly guardedTeDb: Kysely<TaskExecutionDb>;
  readonly activeDatabaseUrl: InitialContextSuite['activeDatabaseUrl'];
  readonly tePool: InitialContextSuite['tePool'];
  readonly firstRunConfig: Parameters<typeof createControlledFirstRunEntry>[0];
  readonly scanContext: ScenarioScanContext;
  readonly scanProof: () => Promise<void>;
  readonly progressAuthorization: ScenarioProgressAuthorization;
  readonly progressListAuthorization: ScenarioProgressListAuthorization;
  readonly progressEnvelope: ScenarioProgressEnvelope;
  readonly usageProbe?:
    ((stage: 'CANCELLED' | 'ISOLATED', runRef: Common.ObjectRef) => Promise<void>) | undefined;
}

/** The subset of an ALLOW Decision the cancel scenario presents onward. */
export interface AllowedDecision {
  readonly outcome: 'ALLOW';
  readonly authorizationDecisionRef: Common.ContentAddressedRef;
}

export interface RunRow {
  readonly status: string;
  readonly aggregate_version: string;
  readonly ended_at: Date | null;
  readonly termination_reason: string | null;
  readonly work_order_contract_ref: unknown;
  readonly capability_grant_ref: unknown;
}

/**
 * The cancel envelope builders only need the trusted clock/admin/authorization
 * seam, so the arbitration and authorization acceptance files share them.
 */
export interface CancelEnvelopeContext {
  readonly admin: VerifyRunCancellationContext['admin'];
  readonly runRef: Common.ObjectRef;
  clock: number;
  readonly firstRunAuth: VerifyRunCancellationContext['firstRunAuth'];
  readonly identityDeps: VerifyRunCancellationContext['identityDeps'];
  readonly fixture: VerifyRunCancellationContext['fixture'];
  readonly firstRunEntry: VerifyRunCancellationContext['firstRunEntry'];
  readonly sessionFor: VerifyRunCancellationContext['sessionFor'];
  readonly scope: VerifyRunCancellationContext['scope'];
}

export async function readRunRow(state: CancelEnvelopeContext): Promise<RunRow> {
  const rows = await state.admin.query<RunRow>(
    `SELECT status, aggregate_version::text AS aggregate_version, ended_at,
            termination_reason, work_order_contract_ref, capability_grant_ref
       FROM task_execution.run WHERE run_id=$1`,
    [state.runRef.objectId],
  );
  const row = rows.rows[0];
  if (row === undefined) throw new Error('RUN_CANCEL Run row missing');
  return row;
}

export async function countWhere(
  state: CancelEnvelopeContext,
  table: string,
  where: string,
  params: readonly unknown[],
): Promise<number> {
  const rows = await state.admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM task_execution.${table} WHERE ${where}`,
    [...params],
  );
  return rows.rows[0]?.n ?? -1;
}

export async function authorizeCommand(
  state: CancelEnvelopeContext,
  boundary: string,
  principal: Principal,
  commandType: string,
  commandVersion: string,
  payload: CanonicalJsonObject,
  targetRef: Common.ObjectRef,
): Promise<AllowedDecision> {
  const decision = await state.firstRunAuth.authorize(
    state.identityDeps([state.fixture.projectId], principal),
    boundary,
    {
      actorSnapshotRef: principal.actorRef,
      commandType,
      commandVersion,
      commandPayloadHash: digestCanonicalPayload(payload).hash,
      authenticationContextHash: principal.authHash,
      targetRef,
    },
  );
  if (decision.outcome !== 'ALLOW')
    throw new Error(`RUN_CANCEL ${boundary} Decision denied: ${decision.outcome}`);
  return decision;
}

export function commandEnvelope(
  state: CancelEnvelopeContext,
  decision: AllowedDecision,
  principal: Principal,
  input: {
    readonly commandType: string;
    readonly commandVersion: string;
    readonly targetRef: Common.ObjectRef;
    readonly payload: CanonicalJsonObject;
    readonly expectedAggregateVersion?: number;
    readonly idempotencyKey?: string;
  },
) {
  const payloadHash = digestCanonicalPayload(input.payload).hash;
  return {
    commandId: newUuidV7(),
    commandType: input.commandType,
    commandVersion: input.commandVersion,
    scopeRef: state.scope(),
    targetRef: input.targetRef,
    actor: principal.actorRef,
    authorizationDecisionRef: decision.authorizationDecisionRef,
    idempotencyKey: input.idempotencyKey ?? newUuidV7(),
    correlationId: newUuidV7(),
    requestedAt: new Date(state.clock).toISOString(),
    ...(input.expectedAggregateVersion === undefined
      ? {}
      : { expectedAggregateVersion: input.expectedAggregateVersion }),
    payload: input.payload,
    integrity: {
      canonicalizationVersion: '1',
      payloadHash: contentHash(payloadHash.toString('hex')),
    },
  };
}

/**
 * The frozen contract's exact cancellationPolicyRef must be presented; read it
 * from the owning contract row so the Handler's deep-equal and the USABLE
 * VERSIONED resolution both hold.
 */
export async function cancellationPolicyRef(
  state: CancelEnvelopeContext,
): Promise<CanonicalJsonObject> {
  const run = await readRunRow(state);
  const contractId = String(record(run.work_order_contract_ref).objectId);
  const rows = await state.admin.query<{ ref: CanonicalJsonObject }>(
    `SELECT canonical_payload->'executionPolicy'->'cancellationPolicyRef' AS ref
       FROM task_execution.work_order_contract WHERE contract_id::text=$1`,
    [contractId],
  );
  const ref = rows.rows[0]?.ref;
  if (ref === undefined) throw new Error('RUN_CANCEL cancellationPolicyRef missing');
  return ref;
}

export async function buildCancelEnvelope(
  state: CancelEnvelopeContext,
  principal: Principal,
  expectedAggregateVersion: number,
  idempotencyKey?: string,
) {
  const run = await readRunRow(state);
  const policyRef = await cancellationPolicyRef(state);
  const payload = {
    reason: {
      reasonCode: 'HUMAN_REQUEST',
      summary: 'Human operator requested Run cancellation',
      evidenceRefs: [record(run.work_order_contract_ref)],
    },
    requestedAt: new Date(state.clock).toISOString(),
    cancellationPolicyRef: policyRef,
  } as unknown as CanonicalJsonObject;
  const decision = await authorizeCommand(
    state,
    'runCancelRequestV1',
    principal,
    'execution.request_run_cancel',
    '1.0',
    payload,
    state.runRef,
  );
  return commandEnvelope(state, decision, principal, {
    commandType: 'execution.request_run_cancel',
    commandVersion: '1.0',
    targetRef: state.runRef,
    payload,
    expectedAggregateVersion,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  });
}

export async function buildExpireEnvelope(
  state: CancelEnvelopeContext,
  principal: Principal,
  reason: 'LEASE_EXPIRED' | 'DEADLINE_EXCEEDED',
  version: '1.0' | '2.0',
  expectedAggregateVersion: number,
  idempotencyKey?: string,
) {
  const payload = { reason } as unknown as CanonicalJsonObject;
  const decision = await authorizeCommand(
    state,
    version === '2.0' ? 'runExpireV2' : 'runExpireV1',
    principal,
    'execution.expire_run',
    version,
    payload,
    state.runRef,
  );
  return commandEnvelope(state, decision, principal, {
    commandType: 'execution.expire_run',
    commandVersion: version,
    targetRef: state.runRef,
    payload,
    expectedAggregateVersion,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  });
}

/** HUMAN `execution.get_run_state@1.0` mapped to the cancel-specific boundary. */
export async function humanRunState(state: CancelEnvelopeContext, principal: Principal) {
  const payload = { runRef: state.runRef } as unknown as CanonicalJsonObject;
  const decision = await authorizeCommand(
    state,
    'runStateReadForCancelHumanV1',
    principal,
    'execution.get_run_state',
    '1.0',
    payload,
    state.runRef,
  );
  return state.firstRunEntry.getRunState(
    {
      queryId: newUuidV7(),
      queryType: 'execution.get_run_state',
      queryVersion: '1.0',
      scopeRef: state.scope(),
      requester: objectRef(PRINCIPAL_OBJECT, principal.principalId, state.scope()),
      authenticationContextRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.identity.authentication_context',
        objectId: principal.actorSnapshotId,
        scope: state.scope(),
        contentHash: contentHash(principal.authHash.toString('hex')),
      },
      authorizationDecisionRef: decision.authorizationDecisionRef,
      consistencyRequirement: 'AUTHORITATIVE',
      correlationId: newUuidV7(),
      requestedAt: new Date(state.clock).toISOString(),
      payload,
    },
    state.sessionFor(principal),
  );
}

export async function claimStatus(state: CancelEnvelopeContext): Promise<string | undefined> {
  return (
    await state.admin.query<{ status: string }>(
      'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
      [state.runRef.objectId],
    )
  ).rows[0]?.status;
}

export async function terminatedEvents(state: CancelEnvelopeContext) {
  return (
    await state.admin.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM task_execution.outbox_event
        WHERE aggregate_id=$1 AND event_type='execution.RunTerminated'`,
      [state.runRef.objectId],
    )
  ).rows;
}

/** CANCEL-D-002: Human cancel commits RUNNING -> CANCELLING with one Intent. */
async function cancelRow002(state: VerifyRunCancellationContext): Promise<void> {
  const principal = state.operator();
  const envelope = await buildCancelEnvelope(state, principal, 2);
  const committed = await state.firstRunEntry.cancelRun(envelope, state.sessionFor(principal));
  expect(committed, JSON.stringify(committed)).toMatchObject({ status: 'COMMITTED' });
  expect(record(committed).resultPayload).toMatchObject({ status: 'CANCELLING' });

  // Same-key replay returns the original committed receipt.
  expect(await state.firstRunEntry.cancelRun(envelope, state.sessionFor(principal))).toMatchObject({
    status: 'DUPLICATE',
  });
  const receipts = await state.receiptRows(envelope.idempotencyKey);
  expect(receipts).toHaveLength(1);
  expect(receipts[0]).toMatchObject({
    outcome: 'COMMITTED',
    command_type: 'execution.request_run_cancel',
    command_version: '1.0',
  });

  const run = await readRunRow(state);
  expect(run).toMatchObject({ status: 'CANCELLING', ended_at: null });
  expect(run.aggregate_version).toBe('3');
  expect(
    await countWhere(state, 'run_cancellation_intent', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(1);
  expect(await claimStatus(state)).toBe('ACTIVE');
  expect(
    await countWhere(
      state,
      'outbox_event',
      "aggregate_id=$1 AND event_type='execution.RunTerminated'",
      [state.runRef.objectId],
    ),
  ).toBe(0);
  expect(await countWhere(state, 'agent_result', 'run_id=$1', [state.runRef.objectId])).toBe(0);
  expect(
    await countWhere(state, 'agent_result_acceptance', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(0);
  expect(
    await countWhere(state, 'run_budget_consumption', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(0);
  // No Runtime cancel call: the Driver was invoked exactly once, for dispatch.
  expect(state.runtimeDriver.invokedAttemptIds).toEqual([state.attemptRef.objectId]);

  expect(await humanRunState(state, principal)).toMatchObject({
    status: 'CANCELLING',
    aggregateVersion: 3,
  });

  // A different key against the now-CANCELLING Run is rejected without a
  // second Intent or Receipt.
  const conflicting = await buildCancelEnvelope(state, principal, 2);
  await expect(
    state.firstRunEntry.cancelRun(conflicting, state.sessionFor(principal)),
  ).rejects.toMatchObject({ code: 'AGGREGATE_STATE_NOT_ALLOWED' });
  expect(await state.receiptRows(conflicting.idempotencyKey)).toEqual([]);
  expect(
    await countWhere(state, 'run_cancellation_intent', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(1);
}

/** CANCEL-D-003: lease-expiry abandonment plus late-final isolation. */
async function cancelRow003(state: VerifyRunCancellationContext): Promise<void> {
  await cancelRow002(state);

  const wait = Math.max(0, state.runDeadline.getTime() - Date.now() + 100);
  if (wait > 0) await state.waitForDeadline(wait, 'server deadline/cancelLeaseWait');
  state.clock = Date.now();

  const envelope = await buildExpireEnvelope(state, state.service, 'LEASE_EXPIRED', '2.0', 3);
  const committed = await state.firstRunEntry.expireRun(envelope, state.sessionFor(state.service));
  expect(committed, JSON.stringify(committed)).toMatchObject({ status: 'COMMITTED' });
  expect(record(committed).resultPayload).toMatchObject({ status: 'ABANDONED' });

  const run = await readRunRow(state);
  expect(run).toMatchObject({
    status: 'ABANDONED',
    termination_reason: 'EXECUTION_CANCELLATION_UNACKNOWLEDGED',
  });
  expect(run.ended_at).not.toBeNull();
  expect(run.aggregate_version).toBe('4');
  expect(await claimStatus(state)).toBe('EXPIRED');
  expect(
    await countWhere(state, 'run_budget_consumption', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(1);
  const events = await terminatedEvents(state);
  expect(events).toHaveLength(1);
  expect(record(events[0]?.payload).terminalStatus).toBe('ABANDONED');
  expect(await humanRunState(state, state.operator())).toMatchObject({
    status: 'ABANDONED',
    terminationReason: 'EXECUTION_CANCELLATION_UNACKNOWLEDGED',
  });

  // Release the delayed original final on a real Driver sharing the journal,
  // then persist the immutable IG Observation before isolating it.
  const lateDriver = new LocalSyntheticRuntimeDriver(
    undefined,
    state.runtimeJournal,
    () => new Date(state.clock),
  );
  await lateDriver.releaseFinal(state.attemptRef);
  const finalQuery = await state.firstRunQuery(
    'integration.get_runtime_final_observation',
    state.attemptRef,
    { attemptRef: state.attemptRef } as unknown as CanonicalJsonObject,
    'runtimeFinalReadV1',
  );
  const finalView = await state.firstRunEntry.observeRuntimeFinal(
    finalQuery,
    state.sessionFor(state.service),
  );
  expect(finalView).toBeDefined();
  const bindingBefore = await state.firstRunEntry.getRuntimeAttemptBinding(
    await state.firstRunQuery(
      'integration.get_runtime_attempt_binding',
      state.attemptRef,
      { attemptRef: state.attemptRef } as unknown as CanonicalJsonObject,
      'runtimeAttemptBindingReadV1',
    ),
    state.sessionFor(state.service),
  );

  await state.usageProbe?.('CANCELLED', state.runRef);
  const requestedAt = new Date(state.clock).toISOString();
  const isolationPayload = {
    runRef: state.runRef,
    attemptRef: state.attemptRef,
    requestedAt,
  } as unknown as CanonicalJsonObject;
  const decision = await authorizeCommand(
    state,
    'runLateFinalIsolateV1',
    state.service,
    'execution.run.late_final.isolate',
    '1.0',
    isolationPayload,
    state.runRef,
  );
  const isolation = (await state.firstRunEntry.isolateLateFinal(
    {
      runRef: state.runRef,
      attemptRef: state.attemptRef,
      authorizationDecisionRef: decision.authorizationDecisionRef,
      correlationId: newUuidV7(),
      requestedAt,
    },
    state.sessionFor(state.service),
  )) as unknown as {
    auditId: string;
    runId: string;
    observationRef: CanonicalJsonObject;
    resultPayloadHash: CanonicalJsonObject;
  };
  expect(isolation.runId).toBe(state.runRef.objectId);
  expect(isolation.observationRef).toEqual(record(finalView).observationRef);
  expect(isolation.resultPayloadHash).toEqual(record(finalView).resultPayloadHash);

  const audit = (
    await state.admin.query<{
      outcome: string;
      error_code: string;
      target_type: string;
      target_id: string;
      runtime_ref: Record<string, unknown>;
      result_payload_hash: string;
    }>(
      `SELECT outcome, error_code, target_type, target_id::text AS target_id, runtime_ref,
              encode(result_payload_hash,'hex') AS result_payload_hash
         FROM task_execution.audit_record WHERE audit_id=$1`,
      [isolation.auditId],
    )
  ).rows[0];
  expect(audit).toMatchObject({
    outcome: 'REJECTED',
    error_code: 'LATE_RESULT',
    target_type: 'execution.run',
    target_id: state.runRef.objectId,
  });
  expect(record(audit?.runtime_ref).observationRef).toEqual(isolation.observationRef);
  expect(audit?.result_payload_hash).toBe(record(isolation.resultPayloadHash).digest);
  await state.usageProbe?.('ISOLATED', state.runRef);

  // No new eligible Result/Acceptance/output and no Run mutation.
  expect(await countWhere(state, 'agent_result', 'run_id=$1', [state.runRef.objectId])).toBe(0);
  expect(
    await countWhere(state, 'agent_result_acceptance', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(0);
  expect(
    await countWhere(state, 'run_budget_consumption', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(1);
  expect((await readRunRow(state)).aggregate_version).toBe('4');
  expect(
    await state.firstRunEntry.getRuntimeAttemptBinding(
      await state.firstRunQuery(
        'integration.get_runtime_attempt_binding',
        state.attemptRef,
        { attemptRef: state.attemptRef } as unknown as CanonicalJsonObject,
        'runtimeAttemptBindingReadV1',
      ),
      state.sessionFor(state.service),
    ),
  ).toEqual(bindingBefore);
}

/** CANCEL-D-005 supported half: premature @2.0 and @1.0 on a CANCELLING Run. */
async function cancelRow005Supported(state: VerifyRunCancellationContext): Promise<void> {
  const principal = state.operator();
  expect(
    await state.firstRunEntry.cancelRun(
      await buildCancelEnvelope(state, principal, 2),
      state.sessionFor(principal),
    ),
  ).toMatchObject({ status: 'COMMITTED' });
  expect((await readRunRow(state)).status).toBe('CANCELLING');

  // @2.0 LEASE_EXPIRED before the original lease is rejected.
  const early = await buildExpireEnvelope(state, state.service, 'LEASE_EXPIRED', '2.0', 3);
  await expect(
    state.firstRunEntry.expireRun(early, state.sessionFor(state.service)),
  ).rejects.toMatchObject({ code: 'EXECUTION_JUDGMENT_STALE' });
  expect(await state.receiptRows(early.idempotencyKey)).toEqual([]);
  expect((await readRunRow(state)).status).toBe('CANCELLING');
  expect(
    await countWhere(state, 'run_budget_consumption', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(0);

  // @1.0 DEADLINE_EXCEEDED after the deadline cannot write ABANDONED and
  // leaves the Run CANCELLING (never TIMED_OUT). The frozen @1.0 Handler
  // refuses an unsupported status through its pre-existing bare guard, so the
  // acceptance pins rejection plus the unchanged Run, not a refusal code.
  const wait = Math.max(0, state.runDeadline.getTime() - Date.now() + 100);
  if (wait > 0) await state.waitForDeadline(wait, 'server deadline/cancelExpiryWait');
  state.clock = Date.now();
  const legacy = await buildExpireEnvelope(state, state.service, 'DEADLINE_EXCEEDED', '1.0', 3);
  const legacyError = await state.firstRunEntry
    .expireRun(legacy, state.sessionFor(state.service))
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(typeof (legacyError as { code?: unknown }).code).toBe('string');
  expect(await state.receiptRows(legacy.idempotencyKey)).toEqual([]);
  const run = await readRunRow(state);
  expect(run).toMatchObject({ status: 'CANCELLING', ended_at: null });
  expect(run.aggregate_version).toBe('3');
  expect(
    await countWhere(state, 'run_budget_consumption', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(0);
  expect(await terminatedEvents(state)).toEqual([]);
}

/** CANCEL-D-005 negative half: the single-attempt profile is unsupported. */
async function cancelRow005Unsupported(state: VerifyRunCancellationContext): Promise<void> {
  const principal = state.operator();
  expect((await readRunRow(state)).status).toBe('RUNNING');
  const envelope = await buildCancelEnvelope(state, principal, 2);
  await expect(
    state.firstRunEntry.cancelRun(envelope, state.sessionFor(principal)),
  ).rejects.toMatchObject({ code: 'EXECUTION_CRITERION_UNSUPPORTED' });
  expect(await state.receiptRows(envelope.idempotencyKey)).toEqual([]);
  const run = await readRunRow(state);
  expect(run).toMatchObject({ status: 'RUNNING', ended_at: null });
  expect(run.aggregate_version).toBe('2');
  // No Intent and no reservation backfill on the unsupported profile.
  expect(
    await countWhere(state, 'run_cancellation_intent', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(0);
  expect(
    await countWhere(state, 'run_budget_reservation', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(0);
}

/** CANCEL-D-007: structural Intent evidence plus pre-CAS rollback. */
async function cancelRow007(state: VerifyRunCancellationContext): Promise<void> {
  const principal = state.operator();
  const rollbackEnvelope = await buildCancelEnvelope(state, principal, 2);
  const faultTrigger = 'wi244_cancel_fault';
  await state.admin.query(
    `CREATE FUNCTION task_execution.${faultTrigger}() RETURNS trigger
       LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'WI244_CANCEL_FAULT'; END $f$`,
  );
  await state.admin.query(
    `CREATE TRIGGER ${faultTrigger} BEFORE UPDATE ON task_execution.run
       FOR EACH ROW WHEN (NEW.status = 'CANCELLING')
       EXECUTE FUNCTION task_execution.${faultTrigger}()`,
  );
  try {
    await expect(
      state.firstRunEntry.cancelRun(rollbackEnvelope, state.sessionFor(principal)),
    ).rejects.toThrow(/WI244_CANCEL_FAULT/);
  } finally {
    await state.admin.query(`DROP TRIGGER IF EXISTS ${faultTrigger} ON task_execution.run`);
    await state.admin.query(`DROP FUNCTION IF EXISTS task_execution.${faultTrigger}()`);
  }
  // The forced failure after the Intent insert but before the Run CAS rolls
  // back the whole cancel: zero Intent, Run still RUNNING.
  expect(await state.receiptRows(rollbackEnvelope.idempotencyKey)).toEqual([]);
  expect(
    await countWhere(state, 'run_cancellation_intent', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(0);
  const run = await readRunRow(state);
  expect(run).toMatchObject({ status: 'RUNNING', ended_at: null });
  expect(run.aggregate_version).toBe('2');
  expect(await claimStatus(state)).toBe('ACTIVE');
  expect(await terminatedEvents(state)).toEqual([]);
  expect(
    await countWhere(state, 'run_budget_consumption', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(0);

  // A real cancel then commits and leaves one immutable Intent row.
  expect(
    await state.firstRunEntry.cancelRun(
      await buildCancelEnvelope(state, principal, 2),
      state.sessionFor(principal),
    ),
  ).toMatchObject({ status: 'COMMITTED' });
  const intent = (
    await state.admin.query<{ intent_id: string }>(
      'SELECT intent_id::text FROM task_execution.run_cancellation_intent WHERE run_id=$1',
      [state.runRef.objectId],
    )
  ).rows[0];
  expect(intent).toBeDefined();

  const rls = (
    await state.admin.query<{ enabled: boolean; forced: boolean }>(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
         FROM pg_class WHERE oid='task_execution.run_cancellation_intent'::regclass`,
    )
  ).rows[0];
  expect(rls).toEqual({ enabled: true, forced: true });
  const acl = (
    await state.admin.query<{
      sel: boolean;
      ins: boolean;
      upd: boolean;
      del: boolean;
    }>(
      `SELECT has_table_privilege('task_execution_app','task_execution.run_cancellation_intent','SELECT') AS sel,
              has_table_privilege('task_execution_app','task_execution.run_cancellation_intent','INSERT') AS ins,
              has_table_privilege('task_execution_app','task_execution.run_cancellation_intent','UPDATE') AS upd,
              has_table_privilege('task_execution_app','task_execution.run_cancellation_intent','DELETE') AS del`,
    )
  ).rows[0];
  expect(acl).toEqual({ sel: true, ins: true, upd: false, del: false });
  const policies = (
    await state.admin.query<{
      polname: string;
      using_expr: string | null;
      check_expr: string | null;
    }>(
      `SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr,
              pg_get_expr(polwithcheck, polrelid) AS check_expr
         FROM pg_policy WHERE polrelid='task_execution.run_cancellation_intent'::regclass
        ORDER BY polname`,
    )
  ).rows;
  expect(policies.map((policy) => policy.polname)).toEqual([
    'run_cancellation_intent_insert',
    'run_cancellation_intent_owner',
    'run_cancellation_intent_select',
  ]);
  const insertPolicy = policies.find(
    (policy) => policy.polname === 'run_cancellation_intent_insert',
  );
  const selectPolicy = policies.find(
    (policy) => policy.polname === 'run_cancellation_intent_select',
  );
  expect(insertPolicy?.check_expr).toContain('context_allows_project');
  expect(selectPolicy?.using_expr).toContain('context_allows_project');
  await expect(
    state.admin.query(
      'UPDATE task_execution.run_cancellation_intent SET committed_at=committed_at WHERE intent_id=$1',
      [intent?.intent_id],
    ),
  ).rejects.toThrow(/immutable/);
}

/** CANCEL-D-008: existing Process progress is suspended, Driver not re-invoked. */
async function cancelRow008(state: VerifyRunCancellationContext): Promise<void> {
  const principal = state.operator();
  // Persist the real final observation, then create the owning Process progress
  // row while the Run is still RUNNING and a scan candidate.
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
  const observationRef = record(record(finalView).observationRef) as CanonicalJsonObject;
  const run = await readRunRow(state);
  const contractId = String(record(run.work_order_contract_ref).objectId);
  const policyRef = (
    await state.admin.query<{ ref: CanonicalJsonObject }>(
      `SELECT canonical_payload->'executionPolicy'->'leasePolicyRef' AS ref
         FROM task_execution.work_order_contract WHERE contract_id::text=$1`,
      [contractId],
    )
  ).rows[0]?.ref;
  if (policyRef === undefined) throw new Error('RUN_CANCEL leasePolicyRef missing');
  const progressPayload = {
    runRef: state.runRef,
    attemptRef: state.attemptRef,
    sourceRef: observationRef,
    policyRef,
    runVersion: run.aggregate_version,
  } as unknown as CanonicalJsonObject;
  const progressAuthorization = await state.progressAuthorization(progressPayload);
  const processId = controlledFinalProcessId(state.runRef.objectId);
  expect(
    await createControlledFinalProgress(
      state.guardedTeDb,
      progressAuthorization.context,
      state.scanContext,
      state.progressEnvelope(
        progressAuthorization.context,
        processId,
        progressPayload,
        `controlled-final:create:${state.runRef.objectId}:${String(record(observationRef.contentHash).digest)}`,
      ),
      () => new Date(state.clock),
      progressAuthorization.proof,
      state.scanProof,
    ),
  ).toMatchObject({ status: 'COMMITTED' });

  expect(
    await state.firstRunEntry.cancelRun(
      await buildCancelEnvelope(state, principal, 2),
      state.sessionFor(principal),
    ),
  ).toMatchObject({ status: 'COMMITTED' });
  expect((await readRunRow(state)).status).toBe('CANCELLING');
  const invocationsBefore = [...state.runtimeDriver.invokedAttemptIds];

  const recoveryPorts: Parameters<typeof recoverControlledFinalRuns>[2] = {
    now: () => new Date(state.clock),
    revalidateScan: state.scanProof,
    readFinal: () => Promise.resolve(undefined),
    readRun: async (currentRunRef) => {
      const view = await state.firstRunEntry.getRunState(
        await state.firstRunQuery(
          'execution.get_run_state',
          currentRunRef as unknown as Common.ObjectRef,
          { runRef: currentRunRef },
          'runStateReadV1',
        ),
        state.sessionFor(state.service),
      );
      return view;
    },
    readPolicy: () => Promise.reject(new Error('unexpected recovery policy read')),
    listProgress: () =>
      listControlledFinalProgress(
        state.guardedTeDb,
        state.progressListAuthorization.context,
        state.progressListAuthorization.proof,
      ),
    createProgress: () => Promise.reject(new Error('unexpected recovery progress create')),
    advanceProgress: () => Promise.reject(new Error('unexpected recovery progress advance')),
    suspendTimedOutProgress: async (
      progress: ControlledFinalProgress,
      observedStatus: 'TIMED_OUT' | 'CANCELLING' | 'ABANDONED',
    ) => {
      const payload = {
        runRef: progress.runRef,
        sourceRef: progress.sourceRef,
        step: progress.step,
        observedStatus,
      } as unknown as CanonicalJsonObject;
      const authorized = await state.progressAuthorization(payload);
      const outcome = await suspendTimedOutControlledFinalProgress(
        state.teDb,
        authorized.context,
        state.progressEnvelope(
          authorized.context,
          progress.processId,
          payload,
          `controlled-final:suspend:${progress.processId}:${progress.aggregateVersion}`,
          progress.aggregateVersion,
        ),
        progress,
        async (currentRunRef) => {
          const view = await state.firstRunEntry.getRunState(
            await state.firstRunQuery(
              'execution.get_run_state',
              currentRunRef as unknown as Common.ObjectRef,
              { runRef: currentRunRef },
              'runStateReadV1',
            ),
            state.sessionFor(state.service),
          );
          return String(record(view).status);
        },
        authorized.proof,
        observedStatus,
      );
      expect(outcome.status).toBe('COMMITTED');
    },
    execute: () => Promise.reject(new Error('unexpected recovery execute')),
  };

  // The CANCELLING Run's progress is suspended in the same tick without
  // blocking or re-invoking anything else.
  expect(await recoverControlledFinalRuns(state.teDb, state.scanContext, recoveryPorts, 1)).toBe(0);
  const process = (
    await state.admin.query<{ state: string; blocked_reason_code: string | null }>(
      'SELECT state, blocked_reason_code FROM task_execution.process_instance WHERE process_id=$1',
      [processId],
    )
  ).rows[0];
  expect(process).toEqual({ state: 'SUSPENDED', blocked_reason_code: 'RUN_CANCELLING' });
  expect(await recoveryPorts.listProgress()).toEqual([]);
  expect(state.runtimeDriver.invokedAttemptIds).toEqual(invocationsBefore);
}

export async function verifyRunCancellation(
  scenarioState: VerifyRunCancellationContext,
): Promise<boolean> {
  if (scenarioState.terminalScenario !== 'RUN_CANCEL') return false;
  const variant = scenarioState.cancelVariant;
  if (variant === undefined) throw new Error('RUN_CANCEL requires a cancelVariant');
  switch (variant.row) {
    case 'CANCEL-D-002':
      await cancelRow002(scenarioState);
      return true;
    case 'CANCEL-D-003':
      await cancelRow003(scenarioState);
      return true;
    case 'CANCEL-D-005':
      if (variant.phase === 'UNSUPPORTED') await cancelRow005Unsupported(scenarioState);
      else await cancelRow005Supported(scenarioState);
      return true;
    case 'CANCEL-D-007':
      await cancelRow007(scenarioState);
      return true;
    case 'CANCEL-D-008':
      await cancelRow008(scenarioState);
      return true;
    default:
      // CANCEL-D-004/006 and IG-CANCEL-D-* are routed after this hook.
      return false;
  }
}
