import { createControlledFirstRunEntry } from '@zhiju/api/composition';
import {
  createIntegrationRendererDatabase,
  LocalSyntheticRuntimeDriver,
} from '@zhiju/integration-gateway';
import { CONTROLLED_FIRST_RUN_BINDINGS } from '@zhiju/identity-policy';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { KyselyPlugin, QueryId } from 'kysely';
import { expect } from 'vitest';
import { definedValue, record } from './initial-context-fixtures.js';
import {
  authorizeCommand,
  buildCancelEnvelope,
  buildExpireEnvelope,
  countWhere,
  readRunRow,
  type VerifyRunCancellationContext,
} from './initial-context-verify-run-cancellation.js';

/** PR #245 review-fix negatives (findings F1, F2, F3). */
export type CancelReviewPhase = 'DEP_REVOKE' | 'INTENT_FORGERY' | 'PROFILE_BOUND';

const reviewPhases: readonly string[] = ['DEP_REVOKE', 'INTENT_FORGERY', 'PROFILE_BOUND'];

/**
 * F1: a dependency Decision that was current around its owning read must still
 * be current at the isolation Audit commit. Revoking the binding-read authority
 * right after the original final Query returns must leave no new Audit, keep
 * the immutable IG source readable, and still allow an authorized retry.
 */
async function reviewDependencyRevocation(state: VerifyRunCancellationContext): Promise<void> {
  const operator = state.operator();
  expect(
    await state.firstRunEntry.cancelRun(
      await buildCancelEnvelope(state, operator, 2),
      state.sessionFor(operator),
    ),
  ).toMatchObject({ status: 'COMMITTED' });
  expect((await readRunRow(state)).status).toBe('CANCELLING');
  const driver = new LocalSyntheticRuntimeDriver(
    undefined,
    state.runtimeJournal,
    () => new Date(state.clock),
  );
  await driver.releaseFinal(state.attemptRef);
  await state.firstRunEntry.observeRuntimeFinal(
    await state.firstRunQuery(
      'integration.get_runtime_final_observation',
      state.attemptRef,
      { attemptRef: state.attemptRef } as unknown as CanonicalJsonObject,
      'runtimeFinalReadV1',
    ),
    state.sessionFor(state.service),
  );
  const payload = {
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
    payload,
    state.runRef,
  );
  const finalQueries = new Set<QueryId>();
  let revoked = false;
  const plugin: KyselyPlugin = {
    transformQuery(args) {
      if (
        args.node.kind === 'SelectQueryNode' &&
        JSON.stringify(args.node).includes('"name":"runtime_final_observation"')
      )
        finalQueries.add(args.queryId);
      return args.node;
    },
    async transformResult(args) {
      if (finalQueries.has(args.queryId) && !revoked) {
        revoked = true;
        const grantId = definedValue(state.firstRunGrants.get('lateFinalBindingReadV1'));
        expect(
          await state.revokeCapabilityTracked(state.identityDeps([state.fixture.projectId]), {
            targetId: grantId,
            expectedAggregateVersion: '1',
            scope: {
              scopeKind: 'PROJECT',
              enterpriseId: state.fixture.enterpriseId,
              projectId: state.fixture.projectId,
            },
            reasonCode: 'WI244_REVOKE_DEPENDENCY',
            effectiveAt: new Date(state.clock),
            idempotencyKey: newUuidV7(),
          }),
        ).toMatchObject({ status: 'COMMITTED' });
      }
      return args.result;
    },
  };
  const entry = createControlledFirstRunEntry({
    ...state.firstRunConfig,
    integrationGatewayDb: createIntegrationRendererDatabase(state.tePool).withPlugin(plugin),
  });
  const request = {
    ...payload,
    authorizationDecisionRef: decision.authorizationDecisionRef,
    correlationId: newUuidV7(),
  };
  await expect(
    entry.isolateLateFinal(request, state.sessionFor(state.service)),
  ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
  expect(revoked).toBe(true);
  expect(
    await countWhere(state, 'audit_record', "error_code='LATE_RESULT' AND target_id=$1", [
      state.runRef.objectId,
    ]),
  ).toBe(0);
  const storedFinal = await state.firstRunEntry.getRuntimeFinalObservation(
    await state.firstRunQuery(
      'integration.get_runtime_final_observation',
      state.attemptRef,
      { attemptRef: state.attemptRef } as unknown as CanonicalJsonObject,
      'runtimeFinalReadV1',
    ),
    state.sessionFor(state.service),
  );
  expect(record(storedFinal).observationRef).toBeDefined();
  const binding = definedValue(
    CONTROLLED_FIRST_RUN_BINDINGS.find(
      (candidate) => candidate.boundary === 'lateFinalBindingReadV1',
    ),
  );
  await state.grant({
    principal: state.service,
    capabilityCode: state.firstRunCodes.lateFinalBindingReadV1,
    action: binding.requiredGrantAction,
    selectorType: binding.selectorType,
    targetObjectType: definedValue(binding.targetObjectTypes[0]),
  });
  const retried = await state.firstRunEntry.isolateLateFinal(
    { ...request, correlationId: newUuidV7() },
    state.sessionFor(state.service),
  );
  expect(retried.observationRef).toEqual(record(storedFinal).observationRef);
  expect(
    await countWhere(state, 'audit_record', "error_code='LATE_RESULT' AND target_id=$1", [
      state.runRef.objectId,
    ]),
  ).toBe(1);
  expect(await countWhere(state, 'agent_result', 'run_id=$1', [state.runRef.objectId])).toBe(0);
}

/**
 * F2: a candidate Intent whose stored request fields do not reproduce the
 * authorized Receipt request Hash must roll back the whole cancellation.
 */
async function reviewIntentForgery(state: VerifyRunCancellationContext): Promise<void> {
  const operator = state.operator();
  await state.admin.query(`CREATE FUNCTION task_execution.a_wi244_review_forged_intent()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$ BEGIN
      NEW.reason := jsonb_set(NEW.reason, '{reasonCode}', '"REVIEW_FORGED_REASON"'::jsonb);
      NEW.canonical_payload := jsonb_set(NEW.canonical_payload, '{reason}', NEW.reason);
      NEW.payload_hash := sha256(convert_to(
        task_execution.canonical_jsonb_text(NEW.canonical_payload), 'UTF8'));
      RETURN NEW;
    END $f$`);
  await state.admin.query(`CREATE TRIGGER a_wi244_review_forged_intent
    BEFORE INSERT ON task_execution.run_cancellation_intent
    FOR EACH ROW EXECUTE FUNCTION task_execution.a_wi244_review_forged_intent()`);
  const forged = await buildCancelEnvelope(state, operator, 2);
  try {
    await expect(state.firstRunEntry.cancelRun(forged, state.sessionFor(operator))).rejects.toThrow(
      /Run cancellation intent source mismatch/u,
    );
  } finally {
    await state.admin.query(
      'DROP TRIGGER a_wi244_review_forged_intent ON task_execution.run_cancellation_intent',
    );
    await state.admin.query('DROP FUNCTION task_execution.a_wi244_review_forged_intent()');
  }
  expect(
    await countWhere(state, 'run_cancellation_intent', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(0);
  expect(await state.receiptRows(forged.idempotencyKey)).toEqual([]);
  const afterForgery = await readRunRow(state);
  expect(afterForgery).toMatchObject({ status: 'RUNNING', ended_at: null });
  expect(afterForgery.aggregate_version).toBe('2');

  const genuine = await buildCancelEnvelope(state, operator, 2);
  expect(await state.firstRunEntry.cancelRun(genuine, state.sessionFor(operator))).toMatchObject({
    status: 'COMMITTED',
  });
  expect(
    await countWhere(state, 'run_cancellation_intent', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(1);
  const stored = (
    await state.admin.query<{ reason: CanonicalJsonObject }>(
      'SELECT reason FROM task_execution.run_cancellation_intent WHERE run_id=$1',
      [state.runRef.objectId],
    )
  ).rows[0];
  expect(record(definedValue(stored).reason).reasonCode).toBe('HUMAN_REQUEST');
  expect((await readRunRow(state)).status).toBe('CANCELLING');
}

/**
 * F3: the late-isolation support set is the delivered two-attempt profile with
 * its genuine creation-time reservation. A single-attempt TIMED_OUT source is
 * rejected without creating any fact, and the supported source still isolates.
 */
async function reviewProfileBoundary(state: VerifyRunCancellationContext): Promise<void> {
  const bounded = state.cancelVariant?.bounded === true;
  expect(
    await countWhere(state, 'run_budget_reservation', 'run_id=$1', [state.runRef.objectId]),
  ).toBe(bounded ? 1 : 0);
  const wait = Math.max(0, state.runDeadline.getTime() - Date.now() + 100);
  if (wait > 0) await state.waitForDeadline(wait, 'server deadline/profileBoundaryWait');
  state.clock = Date.now();
  expect(
    await state.firstRunEntry.expireRun(
      await buildExpireEnvelope(state, state.service, 'DEADLINE_EXCEEDED', '1.0', 2),
      state.sessionFor(state.service),
    ),
  ).toMatchObject({ status: 'COMMITTED' });
  expect((await readRunRow(state)).status).toBe('TIMED_OUT');
  const driver = new LocalSyntheticRuntimeDriver(
    undefined,
    state.runtimeJournal,
    () => new Date(state.clock),
  );
  await driver.releaseFinal(state.attemptRef);
  const observed = await state.firstRunEntry.observeRuntimeFinal(
    await state.firstRunQuery(
      'integration.get_runtime_final_observation',
      state.attemptRef,
      { attemptRef: state.attemptRef } as unknown as CanonicalJsonObject,
      'runtimeFinalReadV1',
    ),
    state.sessionFor(state.service),
  );
  const payload = {
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
    payload,
    state.runRef,
  );
  const request = {
    ...payload,
    authorizationDecisionRef: decision.authorizationDecisionRef,
    correlationId: newUuidV7(),
  };
  if (bounded) {
    const isolated = await state.firstRunEntry.isolateLateFinal(
      request,
      state.sessionFor(state.service),
    );
    expect(isolated.observationRef).toEqual(record(observed).observationRef);
    expect(isolated.resultPayloadHash).toEqual(record(observed).resultPayloadHash);
    expect(
      await countWhere(state, 'audit_record', "error_code='LATE_RESULT' AND target_id=$1", [
        state.runRef.objectId,
      ]),
    ).toBe(1);
  } else {
    await expect(
      state.firstRunEntry.isolateLateFinal(request, state.sessionFor(state.service)),
    ).rejects.toMatchObject({ code: 'EXECUTION_CRITERION_UNSUPPORTED' });
    expect(
      await countWhere(state, 'audit_record', "error_code='LATE_RESULT' AND target_id=$1", [
        state.runRef.objectId,
      ]),
    ).toBe(0);
    expect(
      await countWhere(state, 'run_budget_reservation', 'run_id=$1', [state.runRef.objectId]),
    ).toBe(0);
  }
  expect(await countWhere(state, 'agent_result', 'run_id=$1', [state.runRef.objectId])).toBe(0);
}

export async function verifyCancelReview(
  scenarioState: VerifyRunCancellationContext,
): Promise<boolean> {
  if (scenarioState.terminalScenario !== 'RUN_CANCEL') return false;
  const phase = scenarioState.cancelVariant?.phase;
  if (phase === undefined || !reviewPhases.includes(phase)) return false;
  switch (phase as CancelReviewPhase) {
    case 'DEP_REVOKE':
      await reviewDependencyRevocation(scenarioState);
      return true;
    case 'INTENT_FORGERY':
      await reviewIntentForgery(scenarioState);
      return true;
    case 'PROFILE_BOUND':
      await reviewProfileBoundary(scenarioState);
      return true;
  }
}
