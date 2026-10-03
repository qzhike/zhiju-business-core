import { createControlledFirstRunEntry } from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import { CONTROLLED_FIRST_RUN_BINDINGS } from '@zhiju/identity-policy';
import {
  createIntegrationRendererDatabase,
  LocalSyntheticRuntimeDriver,
} from '@zhiju/integration-gateway';
import { type CanonicalJsonObject, newUuidV7 } from '@zhiju/shared-kernel';
import { digestCanonicalPayload } from '@zhiju/task-execution';
import type { KyselyPlugin } from 'kysely';
import pg from 'pg';
import { expect } from 'vitest';
import {
  contentHash,
  definedValue,
  objectRef,
  PRINCIPAL_OBJECT,
  record,
  type Principal,
} from './initial-context-fixtures.js';
import {
  authorizeCommand,
  buildCancelEnvelope,
  buildExpireEnvelope,
  countWhere,
  readRunRow,
  type VerifyRunCancellationContext,
} from './initial-context-verify-run-cancellation.js';

/** CANCEL-D-006 independent authorization at the persistence boundary. */

interface ProbeEntry {
  readonly entry: VerifyRunCancellationContext['firstRunEntry'];
  readonly reads: string[];
}

type ControlledBoundary = (typeof CONTROLLED_FIRST_RUN_BINDINGS)[number]['boundary'];

/**
 * A first-Run entry equivalent to the scenario's own, but with every business
 * database wrapped so a boundary's protected read can be proven absent.
 */
function probeEntry(state: VerifyRunCancellationContext): ProbeEntry {
  const reads: string[] = [];
  const plugin: KyselyPlugin = {
    transformQuery(args) {
      if (args.node.kind === 'SelectQueryNode') reads.push(JSON.stringify(args.node));
      return args.node;
    },
    transformResult: (args) => Promise.resolve(args.result),
  };
  const entry = createControlledFirstRunEntry({
    ...state.firstRunConfig,
    taskExecutionDb: state.teDb.withPlugin(plugin),
    identity: { ...state.firstRunConfig.identity, db: state.identityDb.withPlugin(plugin) },
    integrationGatewayDb: createIntegrationRendererDatabase(state.tePool).withPlugin(plugin),
  });
  return { entry, reads };
}

function assertNoTableRead(reads: readonly string[], table: string, label: string): void {
  expect(
    reads.filter((query) => query.includes(`"name":"${table}"`)),
    label,
  ).toEqual([]);
}

async function revokeBoundaryGrant(
  state: VerifyRunCancellationContext,
  boundary: ControlledBoundary,
) {
  const grantId = state.firstRunGrants.get(boundary);
  if (grantId === undefined) throw new Error(`missing ${boundary} Grant`);
  expect(
    await state.revokeCapabilityTracked(state.identityDeps([state.fixture.projectId]), {
      targetId: grantId,
      expectedAggregateVersion: '1',
      scope: {
        scopeKind: 'PROJECT',
        enterpriseId: state.fixture.enterpriseId,
        projectId: state.fixture.projectId,
      },
      reasonCode: `WI244_REVOKE_${boundary}`,
      effectiveAt: new Date(state.clock),
      idempotencyKey: newUuidV7(),
    }),
  ).toMatchObject({ status: 'COMMITTED' });
}

async function regrantBoundary(state: VerifyRunCancellationContext, boundary: ControlledBoundary) {
  const binding = CONTROLLED_FIRST_RUN_BINDINGS.find(
    (candidate) => candidate.boundary === boundary,
  );
  const targetObjectType = binding?.targetObjectTypes[0];
  if (binding === undefined || targetObjectType === undefined)
    throw new Error(`missing ${boundary} binding`);
  await state.grant({
    principal: binding.expectedPrincipalKind === 'HUMAN' ? state.operator() : state.service,
    capabilityCode: state.firstRunCodes[boundary],
    action: binding.requiredGrantAction,
    selectorType: binding.selectorType,
    targetObjectType,
  });
}

function humanStateQuery(
  state: VerifyRunCancellationContext,
  principal: Principal,
  decisionRef: Common.ContentAddressedRef,
) {
  const payload = { runRef: state.runRef } as unknown as CanonicalJsonObject;
  return {
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
    authorizationDecisionRef: decisionRef,
    consistencyRequirement: 'AUTHORITATIVE',
    correlationId: newUuidV7(),
    requestedAt: new Date(state.clock).toISOString(),
    payload,
  };
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

function isolationRequest(
  state: VerifyRunCancellationContext,
  decisionRef: Common.ContentAddressedRef,
) {
  return {
    runRef: state.runRef,
    attemptRef: state.attemptRef,
    authorizationDecisionRef: decisionRef,
    correlationId: newUuidV7(),
    requestedAt: new Date(state.clock).toISOString(),
  };
}

async function auditCount(state: VerifyRunCancellationContext): Promise<number> {
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

/**
 * CANCEL-D-006(a)/(b): every cancellation/expiry/late-final boundary gates its
 * own protected read, and a valid cross-boundary Decision is still refused.
 */
async function authorizationBoundaries(state: VerifyRunCancellationContext): Promise<void> {
  const operator = state.operator();
  const { entry, reads } = probeEntry(state);
  const cancelEnvelope = await buildCancelEnvelope(state, operator, 2);

  const expireEnvelope = await buildExpireEnvelope(state, state.service, 'LEASE_EXPIRED', '2.0', 2);
  reads.length = 0;
  const wrongVersion = await buildCancelEnvelope(state, operator, 99);
  await expect(entry.cancelRun(wrongVersion, state.sessionFor(operator))).rejects.toMatchObject({
    code: 'AGGREGATE_STATE_NOT_ALLOWED',
  });
  expect(
    reads.filter((query) => query.includes('"name":"policy_version"')),
    'policy resolve positive control',
  ).not.toEqual([]);

  await revokeBoundaryGrant(state, 'runCancelRequestV1');
  reads.length = 0;
  await expect(entry.cancelRun(cancelEnvelope, state.sessionFor(operator))).rejects.toMatchObject({
    code: 'AUTHORIZATION_REVOKED',
  });
  assertNoTableRead(reads, 'run', 'runCancelRequestV1 revoked');
  expect(await state.receiptRows(cancelEnvelope.idempotencyKey)).toEqual([]);
  await regrantBoundary(state, 'runCancelRequestV1');

  await revokeBoundaryGrant(state, 'runCancelPolicyReadV1');
  reads.length = 0;
  await expect(entry.cancelRun(cancelEnvelope, state.sessionFor(operator))).rejects.toMatchObject({
    code: 'AUTHORIZATION_REVOKED',
  });
  assertNoTableRead(reads, 'policy_version', 'runCancelPolicyReadV1 revoked');
  await regrantBoundary(state, 'runCancelPolicyReadV1');

  const humanRead = await state.firstRunAuth.authorize(
    state.identityDeps([state.fixture.projectId], operator),
    'runStateReadForCancelHumanV1',
    {
      actorSnapshotRef: operator.actorRef,
      commandType: 'execution.get_run_state',
      commandVersion: '1.0',
      commandPayloadHash: digestCanonicalPayload({
        runRef: state.runRef,
      } as unknown as CanonicalJsonObject).hash,
      authenticationContextHash: operator.authHash,
      targetRef: state.runRef,
    },
  );
  expect(humanRead.outcome).toBe('ALLOW');
  if (humanRead.outcome !== 'ALLOW') throw new Error('human cancel state read denied');
  expect(
    await entry.getRunState(
      humanStateQuery(state, operator, humanRead.authorizationDecisionRef),
      state.sessionFor(operator),
    ),
  ).toMatchObject({ status: 'RUNNING' });
  await revokeBoundaryGrant(state, 'runStateReadForCancelHumanV1');
  reads.length = 0;
  await expect(
    entry.getRunState(
      humanStateQuery(state, operator, humanRead.authorizationDecisionRef),
      state.sessionFor(operator),
    ),
  ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
  assertNoTableRead(reads, 'run', 'runStateReadForCancelHumanV1 revoked');
  await regrantBoundary(state, 'runStateReadForCancelHumanV1');

  reads.length = 0;
  await expect(
    entry.expireRun(expireEnvelope, state.sessionFor(state.service)),
  ).rejects.toMatchObject({ code: 'EXECUTION_CRITERION_UNSUPPORTED' });
  expect(
    reads.filter((query) => query.includes('"name":"run"')),
    'expire positive control reads the Run',
  ).not.toEqual([]);
  expect(
    reads.filter((query) => query.includes('"name":"execution_capability_bundle"')),
    'expire positive control inspects the Bundle',
  ).not.toEqual([]);

  await revokeBoundaryGrant(state, 'runExpireV2');
  reads.length = 0;
  await expect(
    entry.expireRun(expireEnvelope, state.sessionFor(state.service)),
  ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
  assertNoTableRead(reads, 'run', 'runExpireV2 revoked');
  await regrantBoundary(state, 'runExpireV2');

  await revokeBoundaryGrant(state, 'runExpireBundleInspectV2');
  reads.length = 0;
  await expect(
    entry.expireRun(expireEnvelope, state.sessionFor(state.service)),
  ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
  assertNoTableRead(reads, 'execution_capability_bundle', 'runExpireBundleInspectV2 revoked');
  await regrantBoundary(state, 'runExpireBundleInspectV2');

  // (b) The frozen SERVICE `runStateReadV1` refuses a HUMAN Grant.
  const runStateBinding = definedValue(
    CONTROLLED_FIRST_RUN_BINDINGS.find((candidate) => candidate.boundary === 'runStateReadV1'),
  );
  await state.grant({
    principal: operator,
    capabilityCode: state.firstRunCodes.runStateReadV1,
    action: runStateBinding.requiredGrantAction,
    selectorType: runStateBinding.selectorType,
    targetObjectType: definedValue(runStateBinding.targetObjectTypes[0]),
  });
  const humanServiceRead = await state.firstRunAuth.authorize(
    state.identityDeps([state.fixture.projectId], operator),
    'runStateReadV1',
    {
      actorSnapshotRef: operator.actorRef,
      commandType: 'execution.get_run_state',
      commandVersion: '1.0',
      commandPayloadHash: digestCanonicalPayload({
        runRef: state.runRef,
      } as unknown as CanonicalJsonObject).hash,
      authenticationContextHash: operator.authHash,
      targetRef: state.runRef,
    },
  );
  expect(
    humanServiceRead.outcome,
    'HUMAN principal cannot hold the SERVICE state read boundary',
  ).toBe('DENY');

  // (b) A cancel Decision cannot authorize a state read.
  reads.length = 0;
  await expect(
    entry.getRunState(
      humanStateQuery(state, operator, cancelEnvelope.authorizationDecisionRef),
      state.sessionFor(operator),
    ),
  ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
  assertNoTableRead(reads, 'run', 'cancel Decision cannot authorize a state read');

  // Commit the real cancellation so the late-final boundaries have a target.
  expect(await entry.cancelRun(cancelEnvelope, state.sessionFor(operator))).toMatchObject({
    status: 'COMMITTED',
  });
  expect((await readRunRow(state)).status).toBe('CANCELLING');

  const finalView = await releaseAndObserveFinal(state);
  const isolationPayload = {
    runRef: state.runRef,
    attemptRef: state.attemptRef,
    requestedAt: new Date(state.clock).toISOString(),
  } as unknown as CanonicalJsonObject;
  const isolationDecision = await authorizeCommand(
    state,
    'runLateFinalIsolateV1',
    state.service,
    'execution.run.late_final.isolate',
    '1.0',
    isolationPayload,
    state.runRef,
  );
  const request = isolationRequest(state, isolationDecision.authorizationDecisionRef);

  reads.length = 0;
  const isolated = (await entry.isolateLateFinal(
    request,
    state.sessionFor(state.service),
  )) as unknown as {
    auditId: string;
    observationRef: CanonicalJsonObject;
  };
  expect(record(finalView).observationRef).toEqual(isolated.observationRef);
  expect(
    reads.filter((query) => query.includes('"name":"runtime_attempt"')),
    'positive isolation reads the Attempt',
  ).not.toEqual([]);
  expect(
    reads.filter((query) => query.includes('"name":"runtime_final_observation"')),
    'positive isolation reads the final',
  ).not.toEqual([]);
  expect(
    reads.filter((query) => query.includes('"name":"execution_capability_bundle"')),
    'positive isolation inspects the Bundle',
  ).not.toEqual([]);
  expect(await auditCount(state)).toBe(1);

  await revokeBoundaryGrant(state, 'runLateFinalIsolateV1');
  reads.length = 0;
  await expect(
    entry.isolateLateFinal(request, state.sessionFor(state.service)),
  ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
  assertNoTableRead(reads, 'run', 'runLateFinalIsolateV1 revoked');
  await regrantBoundary(state, 'runLateFinalIsolateV1');

  await revokeBoundaryGrant(state, 'lateFinalBindingReadV1');
  reads.length = 0;
  await expect(
    entry.isolateLateFinal(request, state.sessionFor(state.service)),
  ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
  assertNoTableRead(reads, 'runtime_attempt', 'lateFinalBindingReadV1 revoked');
  await regrantBoundary(state, 'lateFinalBindingReadV1');

  await revokeBoundaryGrant(state, 'lateFinalObservationReadV1');
  reads.length = 0;
  await expect(
    entry.isolateLateFinal(request, state.sessionFor(state.service)),
  ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
  assertNoTableRead(reads, 'runtime_final_observation', 'lateFinalObservationReadV1 revoked');
  await regrantBoundary(state, 'lateFinalObservationReadV1');

  await revokeBoundaryGrant(state, 'lateFinalBundleInspectV1');
  reads.length = 0;
  await expect(
    entry.isolateLateFinal(request, state.sessionFor(state.service)),
  ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
  assertNoTableRead(reads, 'execution_capability_bundle', 'lateFinalBundleInspectV1 revoked');
  await regrantBoundary(state, 'lateFinalBundleInspectV1');

  expect(await auditCount(state)).toBe(1);
  expect((await readRunRow(state)).aggregate_version).toBe('3');
  expect(await countWhere(state, 'agent_result', 'run_id=$1', [state.runRef.objectId])).toBe(0);
}

async function awaitBundleExpiry(state: VerifyRunCancellationContext) {
  const bundleId = String(record(state.bundleRef).objectId);
  const wait = Math.max(0, definedValue(state.bundleValidUntil).getTime() - Date.now() + 100);
  if (wait > 0) await state.waitForDeadline(wait, 'server deadline/bundleExpired');
  state.clock = Date.now();
  const expired = (
    await state.admin.query<{ expired: boolean }>(
      'SELECT clock_timestamp() > valid_until AS expired FROM identity_policy.execution_capability_bundle WHERE bundle_id=$1',
      [bundleId],
    )
  ).rows[0];
  expect(expired).toEqual({ expired: true });
}

/**
 * CANCEL-D-006(c): an independent cleanup authority still commits
 * expiry/isolation while the execution Bundle is expired, and fails closed once
 * its own Grant is revoked.
 */
async function cleanupAuthority(state: VerifyRunCancellationContext): Promise<void> {
  const operator = state.operator();
  expect(
    await state.firstRunEntry.cancelRun(
      await buildCancelEnvelope(state, operator, 2),
      state.sessionFor(operator),
    ),
  ).toMatchObject({ status: 'COMMITTED' });
  expect((await readRunRow(state)).status).toBe('CANCELLING');

  const expireEnvelope = await buildExpireEnvelope(state, state.service, 'LEASE_EXPIRED', '2.0', 3);
  await revokeBoundaryGrant(state, 'runExpireV2');
  await expect(
    state.firstRunEntry.expireRun(expireEnvelope, state.sessionFor(state.service)),
  ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
  const stillCancelling = await readRunRow(state);
  expect(stillCancelling).toMatchObject({ status: 'CANCELLING', ended_at: null });
  expect(stillCancelling.aggregate_version).toBe('3');
  expect(
    await countWhere(state, 'run_budget_consumption', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(0);
  await regrantBoundary(state, 'runExpireV2');

  await awaitBundleExpiry(state);
  const committed = await state.firstRunEntry.expireRun(
    expireEnvelope,
    state.sessionFor(state.service),
  );
  expect(committed, JSON.stringify(committed)).toMatchObject({ status: 'COMMITTED' });
  expect(record(committed).resultPayload).toMatchObject({ status: 'ABANDONED' });
  const abandoned = await readRunRow(state);
  expect(abandoned).toMatchObject({
    status: 'ABANDONED',
    termination_reason: 'EXECUTION_CANCELLATION_UNACKNOWLEDGED',
  });
  expect(abandoned.aggregate_version).toBe('4');

  const finalView = await releaseAndObserveFinal(state);
  const isolationPayload = {
    runRef: state.runRef,
    attemptRef: state.attemptRef,
    requestedAt: new Date(state.clock).toISOString(),
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
  const request = isolationRequest(state, decision.authorizationDecisionRef);

  await revokeBoundaryGrant(state, 'runLateFinalIsolateV1');
  await expect(
    state.firstRunEntry.isolateLateFinal(request, state.sessionFor(state.service)),
  ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
  expect(await auditCount(state)).toBe(0);
  expect((await readRunRow(state)).status).toBe('ABANDONED');
  await regrantBoundary(state, 'runLateFinalIsolateV1');

  const isolated = (await state.firstRunEntry.isolateLateFinal(
    request,
    state.sessionFor(state.service),
  )) as unknown as { auditId: string; observationRef: CanonicalJsonObject };
  expect(record(finalView).observationRef).toEqual(isolated.observationRef);
  expect(await auditCount(state)).toBe(1);
  expect((await readRunRow(state)).aggregate_version).toBe('4');
  expect(await countWhere(state, 'agent_result', 'run_id=$1', [state.runRef.objectId])).toBe(0);
}

/**
 * CANCEL-D-006(d): revoking the cancel Grant after the Run row lock is taken
 * but before commit refuses the command with no Intent, terminal or Audit.
 */
async function revokeBetweenLockAndCommit(state: VerifyRunCancellationContext): Promise<void> {
  const operator = state.operator();
  const cancelEnvelope = await buildCancelEnvelope(state, operator, 2);
  const blocker = new pg.Client({ connectionString: state.activeDatabaseUrl });
  await blocker.connect();
  let outcome: Promise<unknown> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT run_id FROM task_execution.run WHERE run_id=$1 FOR UPDATE', [
      state.runRef.objectId,
    ]);
    const blockerPid = definedValue(
      (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0],
    ).pid;
    outcome = state.firstRunEntry.cancelRun(cancelEnvelope, state.sessionFor(operator)).then(
      () => undefined,
      (error: unknown) => error,
    );
    await expect
      .poll(
        async () =>
          (
            await state.admin.query<{ n: number }>(
              'SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',
              [blockerPid],
            )
          ).rows[0]?.n ?? 0,
        { timeout: 20_000 },
      )
      .toBeGreaterThanOrEqual(1);
    await revokeBoundaryGrant(state, 'runCancelRequestV1');
  } finally {
    await blocker.query('ROLLBACK');
    await blocker.end();
  }
  expect(record(await outcome).code).toBe('AUTHORIZATION_REVOKED');
  const run = await readRunRow(state);
  expect(run).toMatchObject({ status: 'RUNNING', ended_at: null });
  expect(run.aggregate_version).toBe('2');
  expect(await state.receiptRows(cancelEnvelope.idempotencyKey)).toEqual([]);
  expect(
    await countWhere(state, 'run_cancellation_intent', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(0);
  expect(
    await countWhere(state, 'audit_record', 'command_id=$1', [String(cancelEnvelope.commandId)]),
  ).toBe(0);
}

/** CANCEL-D-006 independent-authorization acceptance router. */
export async function verifyCancelAuthorization(
  state: VerifyRunCancellationContext,
): Promise<boolean> {
  if (state.terminalScenario !== 'RUN_CANCEL') return false;
  const variant = state.cancelVariant;
  if (variant?.row !== 'CANCEL-D-006') return false;
  switch (variant.phase) {
    case 'AUTH':
      await authorizationBoundaries(state);
      return true;
    case 'CLEANUP':
      await cleanupAuthority(state);
      return true;
    case 'LOCK_REVOKE':
      await revokeBetweenLockAndCommit(state);
      return true;
    default:
      throw new Error(`CANCEL-D-006 requires an authorization phase; got ${String(variant.phase)}`);
  }
}
