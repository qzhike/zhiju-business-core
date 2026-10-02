import type { createControlledFirstRunEntry } from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import type { createControlledFirstRunAuthorizationPort } from '@zhiju/identity-policy';
import {
  CONTROLLED_FIRST_RUN_BINDINGS,
  createActorSnapshot,
  readIntegrityForExpiry,
  withIdentityTransaction,
} from '@zhiju/identity-policy';
import type { InMemoryRenderObjectStorage } from '@zhiju/integration-gateway';
import { LocalSyntheticRuntimeDriver } from '@zhiju/integration-gateway';
import { type CanonicalJsonObject, newUuidV7 } from '@zhiju/shared-kernel';
import { digestCanonicalPayload } from '@zhiju/task-execution';
import { expect } from 'vitest';
import {
  AUTH_HASH,
  contentHash,
  definedValue,
  objectRef,
  OPERATOR,
  OPERATOR_ACTOR,
  type Principal,
  record,
} from './initial-context-fixtures.js';
import type {
  ScenarioFirstRunCodes,
  ScenarioFirstRunEnvelope,
  ScenarioFirstRunQuery,
  ScenarioTerminalScenario,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifyTerminalExpiryContext {
  readonly terminalScenario: ScenarioTerminalScenario;
  readonly runDeadline: Date;
  readonly waitForDeadline: InitialContextSuite['waitForDeadline'];
  clock: InitialContextSuite['clock'];
  readonly firstRunEntry: ReturnType<typeof createControlledFirstRunEntry>;
  readonly firstRunEnvelope: ScenarioFirstRunEnvelope;
  readonly runRef: Common.ObjectRef;
  service: Principal;
  readonly sessionFor: InitialContextSuite['sessionFor'];
  readonly runtimeJournal: InMemoryRenderObjectStorage;
  readonly attemptRef: Common.ObjectRef;
  readonly firstRunQuery: ScenarioFirstRunQuery;
  readonly scope: InitialContextSuite['scope'];
  readonly receiptRows: InitialContextSuite['receiptRows'];
  admin: InitialContextSuite['admin'];
  readonly runtimeDriver: LocalSyntheticRuntimeDriver;
  readonly bundleValidUntil: Date | undefined;
  readonly bundleRef: unknown;
  readonly firstRunAuth: ReturnType<typeof createControlledFirstRunAuthorizationPort>;
  readonly identityDeps: InitialContextSuite['identityDeps'];
  fixture: InitialContextSuite['fixture'];
  readonly runnerContext: InitialContextSuite['runnerContext'];
  identityDb: InitialContextSuite['identityDb'];
  readonly firstRunGrants: Map<string, string>;
  readonly revokeCapabilityTracked: InitialContextSuite['revokeCapabilityTracked'];
  readonly queryReads: string[];
  readonly protectedReads: () => string[];
  readonly identityContext: InitialContextSuite['identityContext'];
  identityRepo: InitialContextSuite['identityRepo'];
  readonly grant: InitialContextSuite['grant'];
  readonly firstRunCodes: ScenarioFirstRunCodes;
}

export async function verifyTerminalExpiry(
  scenarioState: VerifyTerminalExpiryContext,
): Promise<boolean> {
  if (
    scenarioState.terminalScenario === 'TIMED_OUT' ||
    scenarioState.terminalScenario === 'TERMINAL_BEFORE_FINAL' ||
    scenarioState.terminalScenario === 'TIMED_OUT_BUNDLE_EXPIRED'
  ) {
    const deadlineWait = Math.max(0, scenarioState.runDeadline.getTime() - Date.now() + 100);
    if (deadlineWait > 0)
      await scenarioState.waitForDeadline(deadlineWait, 'server deadline/deadlineWait');
    scenarioState.clock = Date.now();
    if (scenarioState.terminalScenario === 'TERMINAL_BEFORE_FINAL') {
      const closed = await scenarioState.firstRunEntry.expireRun(
        await scenarioState.firstRunEnvelope(
          'execution.expire_run',
          scenarioState.runRef,
          { reason: 'DEADLINE_EXCEEDED' },
          scenarioState.service,
          2,
        ),
        scenarioState.sessionFor(scenarioState.service),
      );
      expect(closed).toMatchObject({ status: 'COMMITTED' });
    }
    const lateDriver = new LocalSyntheticRuntimeDriver(
      undefined,
      scenarioState.runtimeJournal,
      () => new Date(scenarioState.clock),
    );
    await lateDriver.releaseFinal(scenarioState.attemptRef);
    expect((await lateDriver.readFinal(scenarioState.attemptRef))?.observedAt).toEqual(
      new Date(scenarioState.clock),
    );
    const lateFinalQuery = await scenarioState.firstRunQuery(
      'integration.get_runtime_final_observation',
      scenarioState.attemptRef,
      { attemptRef: scenarioState.attemptRef } as unknown as CanonicalJsonObject,
      'runtimeFinalReadV1',
    );
    const lateFinal = await scenarioState.firstRunEntry.observeRuntimeFinal(
      lateFinalQuery,
      scenarioState.sessionFor(scenarioState.service),
    );
    expect(lateFinal).toBeDefined();
    if (scenarioState.terminalScenario === 'TERMINAL_BEFORE_FINAL') {
      if (lateFinal === undefined) throw new Error('missing terminal-late final');
      expect(
        await scenarioState.firstRunEntry.getRuntimeFinalObservation(
          lateFinalQuery,
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).toEqual(lateFinal);
      const lateBody = record(lateFinal.agentResultContract);
      const lateSubmit = await scenarioState.firstRunEnvelope(
        'execution.submit_agent_result',
        objectRef(
          'execution.agent_result',
          String(lateBody.agentResultId),
          scenarioState.scope(),
        ) as Common.ObjectRef,
        {
          agentResultContract: lateBody,
          runFencingToken: 1,
          runtimeSubmissionRef: lateFinal.runtimeSubmissionRef,
        } as unknown as CanonicalJsonObject,
        scenarioState.service,
      );
      await expect(
        scenarioState.firstRunEntry.submitAgentResult(
          lateSubmit,
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).rejects.toBeDefined();
      expect(await scenarioState.receiptRows(lateSubmit.idempotencyKey)).toEqual([]);
      expect(
        (
          await scenarioState.admin.query<{ count: string }>(
            'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
            [scenarioState.runRef.objectId],
          )
        ).rows,
      ).toEqual([{ count: '0' }]);
      expect(
        (
          await scenarioState.admin.query<{ status: string }>(
            'SELECT status FROM task_execution.run WHERE run_id=$1',
            [scenarioState.runRef.objectId],
          )
        ).rows,
      ).toEqual([{ status: 'TIMED_OUT' }]);
      expect(
        (
          await scenarioState.admin.query<{ status: string }>(
            'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
            [scenarioState.runRef.objectId],
          )
        ).rows,
      ).toEqual([{ status: 'EXPIRED' }]);
      expect(scenarioState.runtimeDriver.invokedAttemptIds).toEqual([
        scenarioState.attemptRef.objectId,
      ]);
      return true;
    }
    if (scenarioState.terminalScenario === 'TIMED_OUT_BUNDLE_EXPIRED') {
      const bundleWait = Math.max(
        0,
        definedValue(scenarioState.bundleValidUntil).getTime() - Date.now() + 100,
      );
      if (bundleWait > 0)
        await scenarioState.waitForDeadline(bundleWait, 'server deadline/bundleWait');
      scenarioState.clock = Date.now();
      expect(scenarioState.clock).toBeGreaterThan(
        definedValue(scenarioState.bundleValidUntil).getTime(),
      );
      expect(
        (
          await scenarioState.admin.query<{ expired: boolean }>(
            'SELECT clock_timestamp() > valid_until AS expired FROM identity_policy.execution_capability_bundle WHERE bundle_id=$1',
            [record(scenarioState.bundleRef).objectId],
          )
        ).rows,
      ).toEqual([{ expired: true }]);
    }
    const expiredEnvelope = await scenarioState.firstRunEnvelope(
      'execution.expire_run',
      scenarioState.runRef,
      { reason: 'DEADLINE_EXCEEDED' },
      scenarioState.service,
      2,
    );
    if (scenarioState.terminalScenario === 'TIMED_OUT_BUNDLE_EXPIRED') {
      for (const [label, inspectedBundle, inspectedRun] of [
        [
          'Bundle Hash',
          { ...record(scenarioState.bundleRef), contentHash: contentHash('0'.repeat(64)) },
          scenarioState.runRef,
        ],
        [
          'Run binding',
          record(scenarioState.bundleRef),
          { ...scenarioState.runRef, objectId: newUuidV7() },
        ],
      ] as const) {
        const inspectPayloadHash = digestCanonicalPayload({
          bundleRef: inspectedBundle,
          runRef: inspectedRun,
        } as unknown as CanonicalJsonObject).hash;
        const inspectDecision = await scenarioState.firstRunAuth.authorize(
          scenarioState.identityDeps([scenarioState.fixture.projectId], scenarioState.service),
          'runExpireBundleInspectV1',
          {
            actorSnapshotRef: scenarioState.service.actorRef,
            commandType: 'execution.expire_run',
            commandVersion: '1.0',
            commandPayloadHash: inspectPayloadHash,
            authenticationContextHash: scenarioState.service.authHash,
            targetRef: inspectedBundle as unknown as Common.ContentAddressedRef,
          },
        );
        expect(inspectDecision.outcome, label).toBe('ALLOW');
        if (inspectDecision.outcome !== 'ALLOW') throw new Error('expiry inspect denied');
        const inspectProof = async () => {
          expect(
            await scenarioState.firstRunAuth.revalidate(
              scenarioState.identityDeps([scenarioState.fixture.projectId], scenarioState.service),
              'runExpireBundleInspectV1',
              {
                decisionRef: inspectDecision.authorizationDecisionRef,
                expectedCommandType: 'execution.expire_run',
                expectedCommandVersion: '1.0',
                expectedCommandPayloadHash: inspectPayloadHash,
                expectedAuthenticationContextHash: scenarioState.service.authHash,
                expectedTargetRef: inspectedBundle as unknown as Common.ContentAddressedRef,
              },
            ),
          ).toMatchObject({ valid: true });
        };
        const inspectContext = {
          ...scenarioState.runnerContext(scenarioState.service),
          authorizationDecisionId: inspectDecision.authorizationDecisionRef.objectId,
          authorizationDecisionHash: Buffer.from(
            inspectDecision.authorizationDecisionRef.contentHash.digest,
            'hex',
          ),
          authorizationDecisionExpiresAt: new Date(inspectDecision.expiresAt),
        };
        await expect(
          readIntegrityForExpiry(
            scenarioState.identityDb,
            inspectContext,
            inspectedBundle as unknown as CanonicalJsonObject,
            inspectedRun as unknown as CanonicalJsonObject,
            inspectProof,
          ),
          label,
        ).rejects.toBeDefined();
        expect(await scenarioState.receiptRows(expiredEnvelope.idempotencyKey), label).toEqual([]);
        expect(
          (
            await scenarioState.admin.query<{ status: string }>(
              'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
              [scenarioState.runRef.objectId],
            )
          ).rows,
          label,
        ).toEqual([{ status: 'ACTIVE' }]);
      }
      const expiryGrantId = scenarioState.firstRunGrants.get('runExpireV1');
      const expiryBinding = CONTROLLED_FIRST_RUN_BINDINGS.find(
        (binding) => binding.boundary === 'runExpireV1',
      );
      if (expiryGrantId === undefined || expiryBinding === undefined)
        throw new Error('missing independent expiry Grant');
      expect(
        await scenarioState.revokeCapabilityTracked(
          scenarioState.identityDeps([scenarioState.fixture.projectId]),
          {
            targetId: expiryGrantId,
            expectedAggregateVersion: '1',
            scope: {
              scopeKind: 'PROJECT',
              enterpriseId: scenarioState.fixture.enterpriseId,
              projectId: scenarioState.fixture.projectId,
            },
            reasonCode: 'WI224_REVOKE_EXPIRY',
            effectiveAt: new Date(),
            idempotencyKey: newUuidV7(),
          },
        ),
      ).toMatchObject({ status: 'COMMITTED' });
      scenarioState.queryReads.length = 0;
      await expect(
        scenarioState.firstRunEntry.expireRun(
          expiredEnvelope,
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
      expect(scenarioState.protectedReads(), 'expiry Grant revoked').toEqual([]);
      expect(await scenarioState.receiptRows(expiredEnvelope.idempotencyKey)).toEqual([]);
      const otherServiceId = newUuidV7();
      const otherActorId = newUuidV7();
      await withIdentityTransaction(
        scenarioState.identityDb,
        scenarioState.identityContext([]),
        (trx) =>
          scenarioState.identityRepo.insertPrincipal(trx, {
            id: otherServiceId,
            principalKind: 'SERVICE',
            displayName: 'WI-224 ungranted expiry service',
            createdByPrincipalId: OPERATOR,
            createdByActorSnapshotId: OPERATOR_ACTOR,
          }),
      );
      const otherActorRef = await createActorSnapshot(
        scenarioState.identityDeps([scenarioState.fixture.projectId]),
        {
          actorSnapshotId: otherActorId,
          principalId: otherServiceId,
          declaredPrincipalKind: 'SERVICE',
          authenticationContextHash: AUTH_HASH,
          scopeKind: 'PROJECT',
          enterpriseId: scenarioState.fixture.enterpriseId,
          projectId: scenarioState.fixture.projectId,
        },
      );
      const otherService: Principal = {
        principalId: otherServiceId,
        principalKind: 'SERVICE',
        actorSnapshotId: otherActorId,
        actorRef: otherActorRef,
        authHash: AUTH_HASH,
      };
      const otherExpiryDecision = await scenarioState.firstRunAuth.authorize(
        scenarioState.identityDeps([scenarioState.fixture.projectId], otherService),
        'runExpireV1',
        {
          actorSnapshotRef: otherActorRef,
          commandType: 'execution.expire_run',
          commandVersion: '1.0',
          commandPayloadHash: digestCanonicalPayload(expiredEnvelope.payload).hash,
          authenticationContextHash: AUTH_HASH,
          targetRef: scenarioState.runRef,
        },
      );
      expect(otherExpiryDecision.outcome).toBe('DENY');
      await scenarioState.grant({
        principal: scenarioState.service,
        capabilityCode: scenarioState.firstRunCodes.runExpireV1,
        action: expiryBinding.requiredGrantAction,
        selectorType: expiryBinding.selectorType,
        targetObjectType: 'execution.run',
      });
    }
    const authorizedExpiryEnvelope =
      scenarioState.terminalScenario === 'TIMED_OUT_BUNDLE_EXPIRED'
        ? await scenarioState.firstRunEnvelope(
            'execution.expire_run',
            scenarioState.runRef,
            { reason: 'DEADLINE_EXCEEDED' },
            scenarioState.service,
            2,
          )
        : expiredEnvelope;
    const expired = await scenarioState.firstRunEntry.expireRun(
      authorizedExpiryEnvelope,
      scenarioState.sessionFor(scenarioState.service),
    );
    expect(expired, JSON.stringify(expired)).toMatchObject({ status: 'COMMITTED' });
    expect(
      await scenarioState.firstRunEntry.expireRun(
        authorizedExpiryEnvelope,
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({ status: 'DUPLICATE' });
    const lateBody = record(lateFinal?.agentResultContract);
    const lateSubmit = await scenarioState.firstRunEnvelope(
      'execution.submit_agent_result',
      objectRef(
        'execution.agent_result',
        String(lateBody.agentResultId),
        scenarioState.scope(),
      ) as Common.ObjectRef,
      {
        agentResultContract: lateBody,
        runFencingToken: 1,
        runtimeSubmissionRef: lateFinal?.runtimeSubmissionRef,
      } as unknown as CanonicalJsonObject,
      scenarioState.service,
    );
    await expect(
      scenarioState.firstRunEntry.submitAgentResult(
        lateSubmit,
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).rejects.toBeDefined();
    expect(
      await scenarioState.firstRunEntry.getRunState(
        await scenarioState.firstRunQuery(
          'execution.get_run_state',
          scenarioState.runRef,
          { runRef: scenarioState.runRef } as unknown as CanonicalJsonObject,
          'runStateReadV1',
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({
      status: 'TIMED_OUT',
      terminationReason: 'EXECUTION_DEADLINE_EXCEEDED',
    });
    expect(
      (
        await scenarioState.admin.query<{ status: string }>(
          'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
          [scenarioState.runRef.objectId],
        )
      ).rows,
    ).toEqual([{ status: 'EXPIRED' }]);
    expect(
      (
        await scenarioState.admin.query<{ count: string }>(
          'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
          [scenarioState.runRef.objectId],
        )
      ).rows,
    ).toEqual([{ count: '0' }]);
    expect(
      (
        await scenarioState.admin.query<{ event_type: string; count: string }>(
          "SELECT event_type,count(*)::text FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.RunTerminated' GROUP BY event_type",
          [scenarioState.runRef.objectId],
        )
      ).rows,
    ).toEqual([{ event_type: 'execution.RunTerminated', count: '1' }]);
    return true;
  }
  return false;
}
