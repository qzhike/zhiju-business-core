import type { createControlledFirstRunEntry } from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import type { createControlledFirstRunAuthorizationPort } from '@zhiju/identity-policy';
import type { LocalSyntheticRuntimeDriver } from '@zhiju/integration-gateway';
import { type CanonicalJsonObject, newUuidV7 } from '@zhiju/shared-kernel';
import { digestCanonicalPayload } from '@zhiju/task-execution';
import pg from 'pg';
import { expect } from 'vitest';
import { definedValue, type Principal, profileReference } from './initial-context-fixtures.js';
import type {
  ScenarioFinalQuery,
  ScenarioFinalView,
  ScenarioFirstRunEnvelope,
  ScenarioFirstRunQuery,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifyEligibilityLossContext {
  readonly firstRunEnvelope: ScenarioFirstRunEnvelope;
  readonly eligibilityChange:
    | {
        readonly step: 'SUBMIT' | 'RECORD' | 'VALIDATE' | 'ACCEPT' | 'FINALIZE';
        readonly source: 'GRANT' | 'POLICY';
        readonly whileLocked?: boolean;
      }
    | undefined;
  readonly phase: InitialContextSuite['phase'];
  admin: InitialContextSuite['admin'];
  readonly runRef: Common.ObjectRef;
  clock: InitialContextSuite['clock'];
  readonly runDeadline: Date;
  activeDatabaseUrl: InitialContextSuite['activeDatabaseUrl'];
  readonly progress: InitialContextSuite['progress'];
  readonly revokeCapabilityTracked: InitialContextSuite['revokeCapabilityTracked'];
  readonly identityDeps: InitialContextSuite['identityDeps'];
  fixture: InitialContextSuite['fixture'];
  readonly executionCapabilityGrantId: string;
  readonly independentScenarioGrantIds: Map<string, string>;
  readonly registerPolicyVersionAs: InitialContextSuite['registerPolicyVersionAs'];
  readonly controlsRef: Common.VersionedRef;
  readonly controlFields: string[];
  readonly revised: Record<string, unknown>;
  readonly firstRunAuth: ReturnType<typeof createControlledFirstRunAuthorizationPort>;
  service: Principal;
  readonly receiptRows: InitialContextSuite['receiptRows'];
  readonly waitForDeadline: InitialContextSuite['waitForDeadline'];
  readonly firstRunEntry: ReturnType<typeof createControlledFirstRunEntry>;
  readonly firstRunQuery: ScenarioFirstRunQuery;
  readonly sessionFor: InitialContextSuite['sessionFor'];
  readonly finalQuery: ScenarioFinalQuery;
  readonly finalView: ScenarioFinalView;
  readonly runtimeDriver: LocalSyntheticRuntimeDriver;
  readonly attemptRef: Common.ObjectRef;
}

export async function verifyEligibilityLoss(
  scenarioState: VerifyEligibilityLossContext,
  step: 'SUBMIT' | 'RECORD' | 'VALIDATE' | 'ACCEPT' | 'FINALIZE',
  envelope: Awaited<ReturnType<typeof scenarioState.firstRunEnvelope>>,
  execute: (value: unknown) => Promise<unknown>,
): Promise<boolean> {
  if (scenarioState.eligibilityChange?.step !== step) return false;
  scenarioState.phase(`eligibility boundary ${step}/${scenarioState.eligibilityChange.source}`);
  const facts = async () =>
    (
      await scenarioState.admin.query<{ facts: unknown }>(
        `SELECT jsonb_build_object(
            'result', (SELECT jsonb_agg(to_jsonb(f) ORDER BY result_id) FROM task_execution.agent_result f WHERE run_id=$1),
            'bundle', (SELECT jsonb_agg(to_jsonb(f) ORDER BY bundle_id) FROM task_execution.result_validation_bundle f WHERE run_id=$1),
            'validations', (SELECT jsonb_agg(to_jsonb(f) ORDER BY validation_id) FROM task_execution.result_validation_fact f
              WHERE bundle_id IN (SELECT bundle_id FROM task_execution.result_validation_bundle WHERE run_id=$1)),
            'acceptance', (SELECT jsonb_agg(to_jsonb(f) ORDER BY acceptance_id) FROM task_execution.agent_result_acceptance f WHERE run_id=$1)
          ) AS facts`,
        [scenarioState.runRef.objectId],
      )
    ).rows;
  const originalFacts = await facts();
  const originalRun = (
    await scenarioState.admin.query<{ status: string; aggregate_version: string }>(
      'SELECT status,aggregate_version FROM task_execution.run WHERE run_id=$1',
      [scenarioState.runRef.objectId],
    )
  ).rows;
  scenarioState.clock = Date.now();
  expect(Date.now(), 'eligibility preparation precedes the Run deadline').toBeLessThan(
    scenarioState.runDeadline.getTime(),
  );
  const blocker =
    scenarioState.eligibilityChange.whileLocked === true
      ? new pg.Client({ connectionString: scenarioState.activeDatabaseUrl })
      : undefined;
  let waiting: Promise<{ value?: unknown; error?: unknown }> | undefined;
  if (blocker !== undefined) {
    await blocker.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT run_id FROM task_execution.run WHERE run_id=$1 FOR UPDATE', [
      scenarioState.runRef.objectId,
    ]);
    const blockerPid = definedValue(
      (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0],
    ).pid;
    waiting = execute(envelope).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    let locked = false;
    for (let i = 0; i < 200 && !locked; i++) {
      locked =
        (
          await scenarioState.admin.query<{ locked: boolean }>(
            `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))) AS locked`,
            [blockerPid],
          )
        ).rows[0]?.locked === true;
      if (!locked) await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    if (!locked) {
      await blocker.query('ROLLBACK');
      await blocker.end();
      await waiting;
      throw new Error('owning final command never waited for its Run lock');
    }
  }
  try {
    scenarioState.progress(
      'eligibility change',
      `${step}/${scenarioState.eligibilityChange.source}; remainingMs=${scenarioState.runDeadline.getTime() - Date.now()}`,
    );
    if (scenarioState.eligibilityChange.source === 'GRANT') {
      expect(
        await scenarioState.revokeCapabilityTracked(
          scenarioState.identityDeps([scenarioState.fixture.projectId]),
          {
            targetId: scenarioState.executionCapabilityGrantId,
            expectedAggregateVersion: '1',
            scope: {
              scopeKind: 'PROJECT',
              enterpriseId: scenarioState.fixture.enterpriseId,
              projectId: scenarioState.fixture.projectId,
            },
            reasonCode: 'WI224_REVOKE_BUNDLE_OBSERVATION',
            effectiveAt: new Date(scenarioState.clock),
            idempotencyKey: newUuidV7(),
          },
        ),
      ).toMatchObject({ status: 'COMMITTED' });
      let discarded = false;
      for (const [key, id] of scenarioState.independentScenarioGrantIds)
        if (id === scenarioState.executionCapabilityGrantId) {
          scenarioState.independentScenarioGrantIds.delete(key);
          discarded = true;
        }
      expect(discarded, 'revoked Grant must not be reused by another scenario').toBe(true);
    } else {
      await scenarioState.registerPolicyVersionAs({
        key: { ...scenarioState.controlsRef, versionId: newUuidV7() },
        factId: newUuidV7(),
        idempotencyKey: newUuidV7(),
        effectiveFrom: new Date(scenarioState.clock),
        supersedesRef: scenarioState.controlsRef,
        policySchemaRefs: [profileReference('execution.work_order_controls.policy@1.0')],
        policyDocument: {
          controls: Object.fromEntries(
            scenarioState.controlFields.map((field) => [field, scenarioState.revised[field]]),
          ),
        } as CanonicalJsonObject,
      });
    }
    const ownBoundary = {
      SUBMIT: 'agentResultSubmitV1',
      RECORD: 'runResultRecordV1',
      VALIDATE: 'agentResultValidateV1',
      ACCEPT: 'agentResultAcceptV1',
      FINALIZE: 'runFinalizeV1',
    }[step];
    expect(
      await scenarioState.firstRunAuth.revalidate(
        scenarioState.identityDeps([scenarioState.fixture.projectId], scenarioState.service),
        ownBoundary,
        {
          decisionRef: envelope.authorizationDecisionRef,
          expectedCommandType: envelope.commandType,
          expectedCommandVersion: '1.0',
          expectedCommandPayloadHash: digestCanonicalPayload(envelope.payload).hash,
          expectedAuthenticationContextHash: scenarioState.service.authHash,
          expectedTargetRef: envelope.targetRef,
        },
      ),
    ).toMatchObject({ valid: true });
  } finally {
    scenarioState.clock = Math.max(scenarioState.clock, Date.now());
    if (blocker !== undefined) {
      await blocker.query('ROLLBACK');
      await blocker.end();
    }
  }
  if (waiting !== undefined) {
    expect(scenarioState.clock, 'source loss precedes the Run deadline').toBeLessThan(
      scenarioState.runDeadline.getTime(),
    );
    expect(
      await waiting,
      `${step} ${scenarioState.eligibilityChange.source} after lock`,
    ).toHaveProperty('error');
  } else
    await expect(
      execute(envelope),
      `${step} ${scenarioState.eligibilityChange.source}`,
    ).rejects.toBeDefined();
  expect(Date.now(), 'eligibility refusal precedes the Run deadline').toBeLessThan(
    scenarioState.runDeadline.getTime(),
  );
  scenarioState.progress(
    'eligibility refusal',
    `${step}/${scenarioState.eligibilityChange.source}; remainingMs=${scenarioState.runDeadline.getTime() - Date.now()}`,
  );
  expect(await scenarioState.receiptRows(envelope.idempotencyKey)).toEqual([]);
  expect(await facts()).toEqual(originalFacts);
  expect(
    (
      await scenarioState.admin.query<{ status: string; aggregate_version: string }>(
        'SELECT status,aggregate_version FROM task_execution.run WHERE run_id=$1',
        [scenarioState.runRef.objectId],
      )
    ).rows,
  ).toEqual(originalRun);
  expect(
    (
      await scenarioState.admin.query<{ status: string }>(
        'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
        [scenarioState.runRef.objectId],
      )
    ).rows,
  ).toEqual([{ status: 'ACTIVE' }]);
  const deadlineWait = Math.max(0, scenarioState.runDeadline.getTime() - Date.now() + 100);
  if (deadlineWait > 0)
    await scenarioState.waitForDeadline(deadlineWait, 'server deadline/deadlineWait');
  scenarioState.clock = Date.now();
  const state = await scenarioState.firstRunEntry.getRunState(
    await scenarioState.firstRunQuery(
      'execution.get_run_state',
      scenarioState.runRef,
      { runRef: scenarioState.runRef } as unknown as CanonicalJsonObject,
      'runStateReadV1',
    ),
    scenarioState.sessionFor(scenarioState.service),
  );
  const expiry = await scenarioState.firstRunEnvelope(
    'execution.expire_run',
    scenarioState.runRef,
    { reason: 'DEADLINE_EXCEEDED' },
    scenarioState.service,
    state.aggregateVersion,
  );
  expect(
    await scenarioState.firstRunEntry.expireRun(
      expiry,
      scenarioState.sessionFor(scenarioState.service),
    ),
  ).toMatchObject({
    status: 'COMMITTED',
  });
  expect(
    (
      await scenarioState.admin.query<{ status: string }>(
        'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
        [scenarioState.runRef.objectId],
      )
    ).rows,
  ).toEqual([{ status: 'EXPIRED' }]);
  expect(await facts()).toEqual(originalFacts);
  expect(
    await scenarioState.firstRunEntry.getRuntimeFinalObservation(
      scenarioState.finalQuery,
      scenarioState.sessionFor(scenarioState.service),
    ),
  ).toEqual(scenarioState.finalView);
  expect(scenarioState.runtimeDriver.invokedAttemptIds).toEqual([
    scenarioState.attemptRef.objectId,
  ]);
  return true;
}
