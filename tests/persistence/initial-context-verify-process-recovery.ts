import type { createControlledFirstRunEntry } from '@zhiju/api/composition';
import { createControlledFinalRecoveryWorker } from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import type { createWorkOrderValidationAuthorizationPort } from '@zhiju/identity-policy';
import { CONTROLLED_FIRST_RUN_BINDINGS } from '@zhiju/identity-policy';
import type { LocalSyntheticRuntimeDriver } from '@zhiju/integration-gateway';
import { type CanonicalJsonObject, hashContractPayload, newUuidV7 } from '@zhiju/shared-kernel';
import {
  advanceControlledFinalProgress,
  controlledFinalProcessId,
  type ControlledFinalProgress,
  type ControlledFinalProgressAdvance,
  type ControlledFinalRecoveryCommand,
  createControlledFinalProgress,
  digestCanonicalPayload,
  handleGetWorkOrderContract,
  listControlledFinalProgress,
  recoverControlledFinalRuns,
  suspendTimedOutControlledFinalProgress,
  type TaskExecutionDb,
} from '@zhiju/task-execution';
import type { Kysely } from 'kysely';
import { expect } from 'vitest';
import {
  AUTH_HASH,
  contentHash,
  type Principal,
  record,
  type RecoveryFixture,
} from './initial-context-fixtures.js';
import type {
  ScenarioFinalView,
  ScenarioFirstRunCodes,
  ScenarioFirstRunEnvelope,
  ScenarioFirstRunQuery,
  ScenarioProgressAuthorization,
  ScenarioProgressEnvelope,
  ScenarioProgressListAuthorization,
  ScenarioScanContext,
  ScenarioTerminalScenario,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifyProcessRecoveryContext {
  readonly terminalScenario: ScenarioTerminalScenario;
  clock: InitialContextSuite['clock'];
  readonly scanProof: () => Promise<void>;
  readonly restartedEntry: ReturnType<typeof createControlledFirstRunEntry>;
  readonly firstRunQuery: ScenarioFirstRunQuery;
  readonly sessionFor: InitialContextSuite['sessionFor'];
  service: Principal;
  readonly workOrderRef: Common.ObjectRef;
  readonly auth: ReturnType<typeof createWorkOrderValidationAuthorizationPort>;
  readonly identityDeps: InitialContextSuite['identityDeps'];
  fixture: InitialContextSuite['fixture'];
  readonly runnerContext: InitialContextSuite['runnerContext'];
  teDb: InitialContextSuite['teDb'];
  readonly guardedTeDb: Kysely<TaskExecutionDb>;
  progressListAuthorization: ScenarioProgressListAuthorization;
  readonly progressAuthorization: ScenarioProgressAuthorization;
  readonly scanContext: ScenarioScanContext;
  readonly progressEnvelope: ScenarioProgressEnvelope;
  readonly firstRunEnvelope: ScenarioFirstRunEnvelope;
  readonly runRef: Common.ObjectRef;
  readonly attemptRef: Common.ObjectRef;
  readonly finalView: ScenarioFinalView;
  readonly controlsRef: Common.VersionedRef;
  readonly observeRecovery: ((value: RecoveryFixture) => Promise<void>) | undefined;
  readonly runtimeDriver: LocalSyntheticRuntimeDriver;
  admin: InitialContextSuite['admin'];
  readonly restartedDriver: LocalSyntheticRuntimeDriver;
  readonly firstRunGrants: Map<string, string>;
  readonly revokeCapabilityTracked: InitialContextSuite['revokeCapabilityTracked'];
  readonly queryReads: string[];
  readonly queryWrites: string[];
  readonly protectedReads: () => string[];
  readonly grant: InitialContextSuite['grant'];
  readonly firstRunCodes: ScenarioFirstRunCodes;
  readonly progressListPayload: CanonicalJsonObject;
  readonly receiptRows: InitialContextSuite['receiptRows'];
  readonly scope: InitialContextSuite['scope'];
}

export async function verifyProcessRecovery(
  scenarioState: VerifyProcessRecoveryContext,
): Promise<boolean> {
  if (
    scenarioState.terminalScenario === 'RECOVERY' ||
    scenarioState.terminalScenario === 'RECOVERY_WORKER' ||
    scenarioState.terminalScenario === 'RECOVERY_MULTIPLE'
  ) {
    const executed: string[] = [];
    const committedKeys = new Map<string, string>();
    let failedKey: string | undefined;
    let failedBeforeSubmitKey: string | undefined;
    let failBeforeSubmit = scenarioState.terminalScenario === 'RECOVERY';
    const crashAfterStep = new Set<ControlledFinalProgressAdvance['expectedStep']>(
      scenarioState.terminalScenario === 'RECOVERY'
        ? ['SUBMIT', 'RECORD', 'VALIDATE', 'ACCEPT', 'FINALIZE']
        : [],
    );
    const recoveryPorts = {
      now: () => new Date(scenarioState.clock),
      revalidateScan: scenarioState.scanProof,
      readFinal: async (originalAttemptRef: CanonicalJsonObject) =>
        (await scenarioState.restartedEntry.getRuntimeFinalObservation(
          await scenarioState.firstRunQuery(
            'integration.get_runtime_final_observation',
            originalAttemptRef as unknown as Common.ObjectRef,
            { attemptRef: originalAttemptRef },
            'runtimeFinalReadV1',
          ),
          scenarioState.sessionFor(scenarioState.service),
        )) as unknown as CanonicalJsonObject,
      readRun: async (currentRunRef: CanonicalJsonObject) =>
        (await scenarioState.restartedEntry.getRunState(
          await scenarioState.firstRunQuery(
            'execution.get_run_state',
            currentRunRef as unknown as Common.ObjectRef,
            { runRef: currentRunRef },
            'runStateReadV1',
          ),
          scenarioState.sessionFor(scenarioState.service),
        )) as {
          status: string;
          aggregateVersion: number;
          currentFencingToken: number;
          workOrderRef: CanonicalJsonObject;
        },
      readPolicy: async (currentWorkOrderRef: CanonicalJsonObject) => {
        expect(currentWorkOrderRef).toEqual(scenarioState.workOrderRef);
        const payload = { workOrderRef: currentWorkOrderRef } as CanonicalJsonObject;
        const payloadHash = digestCanonicalPayload(payload).hash;
        const signed = await scenarioState.auth.authorizeWorkOrderContractRead(
          scenarioState.identityDeps([scenarioState.fixture.projectId], scenarioState.service),
          {
            actorSnapshotRef: scenarioState.service.actorRef,
            commandType: 'execution.get_work_order_contract',
            commandVersion: '1.0',
            commandPayloadHash: payloadHash,
            authenticationContextHash: AUTH_HASH,
            targetRef: currentWorkOrderRef as unknown as Common.ObjectRef,
          },
        );
        expect(signed.outcome).toBe('ALLOW');
        if (
          signed.outcome !== 'ALLOW' ||
          signed.authorizationDecisionRef === undefined ||
          signed.expiresAt === undefined
        )
          throw new Error('Contract read denied');
        const decisionRef = signed.authorizationDecisionRef;
        const proof = async () => {
          const validity = await scenarioState.auth.revalidateWorkOrderContractRead(
            scenarioState.identityDeps([scenarioState.fixture.projectId], scenarioState.service),
            {
              decisionRef,
              expectedCommandType: 'execution.get_work_order_contract',
              expectedCommandVersion: '1.0',
              expectedCommandPayloadHash: payloadHash,
              expectedAuthenticationContextHash: AUTH_HASH,
              expectedTargetRef: currentWorkOrderRef as unknown as Common.ObjectRef,
            },
          );
          expect(validity.valid).toBe(true);
        };
        const context = {
          ...scenarioState.runnerContext(scenarioState.service),
          authorizationDecisionId: signed.authorizationDecisionRef.objectId,
          authorizationDecisionHash: Buffer.from(
            signed.authorizationDecisionRef.contentHash.digest,
            'hex',
          ),
          authorizationDecisionExpiresAt: new Date(signed.expiresAt),
        };
        const view = await handleGetWorkOrderContract(
          scenarioState.teDb,
          context,
          currentWorkOrderRef,
          proof,
        );
        return record(record(view.workOrderContract).executionPolicy)
          .leasePolicyRef as CanonicalJsonObject;
      },
      listProgress: () =>
        listControlledFinalProgress(
          scenarioState.guardedTeDb,
          scenarioState.progressListAuthorization.context,
          scenarioState.progressListAuthorization.proof,
        ),
      createProgress: async (input: {
        runRef: CanonicalJsonObject;
        attemptRef: CanonicalJsonObject;
        sourceRef: CanonicalJsonObject;
        policyRef: CanonicalJsonObject;
        runVersion: string;
      }) => {
        const payload = input as unknown as CanonicalJsonObject;
        const authorized = await scenarioState.progressAuthorization(payload);
        const runId = input.runRef.objectId;
        const sourceHash = record(input.sourceRef.contentHash).digest;
        if (typeof runId !== 'string' || typeof sourceHash !== 'string')
          throw new Error('invalid controlled final source');
        const processId = controlledFinalProcessId(runId);
        const outcome = await createControlledFinalProgress(
          scenarioState.guardedTeDb,
          authorized.context,
          scenarioState.scanContext,
          scenarioState.progressEnvelope(
            authorized.context,
            processId,
            payload,
            `controlled-final:create:${runId}:${sourceHash}`,
          ),
          () => new Date(scenarioState.clock),
          authorized.proof,
          scenarioState.scanProof,
        );
        expect(outcome.status).toBe('COMMITTED');
      },
      advanceProgress: async (
        progress: ControlledFinalProgress,
        transition: ControlledFinalProgressAdvance,
      ) => {
        if (crashAfterStep.delete(transition.expectedStep))
          throw new Error(
            `injected crash after ${transition.expectedStep} commit before Process progress`,
          );
        const payload = transition as unknown as CanonicalJsonObject;
        const authorized = await scenarioState.progressAuthorization(payload);
        const outcome = await advanceControlledFinalProgress(
          scenarioState.guardedTeDb,
          authorized.context,
          scenarioState.progressEnvelope(
            authorized.context,
            progress.processId,
            payload,
            `controlled-final:progress:${progress.processId}:${transition.expectedStep}:${transition.stableIdempotencyKey}`,
            progress.aggregateVersion,
          ),
          transition,
          authorized.proof,
        );
        expect(outcome.status).toBe('COMMITTED');
      },
      suspendTimedOutProgress: async (
        progress: ControlledFinalProgress,
        observedStatus: 'TIMED_OUT' | 'CANCELLING' | 'ABANDONED',
      ) => {
        const payload = {
          runRef: progress.runRef,
          sourceRef: progress.sourceRef,
          step: progress.step,
          observedStatus,
        } as CanonicalJsonObject;
        const authorized = await scenarioState.progressAuthorization(payload);
        const outcome = await suspendTimedOutControlledFinalProgress(
          scenarioState.teDb,
          authorized.context,
          scenarioState.progressEnvelope(
            authorized.context,
            progress.processId,
            payload,
            `controlled-final:suspend:${progress.processId}:${progress.aggregateVersion}`,
            progress.aggregateVersion,
          ),
          progress,
          async (currentRunRef) => {
            const state = await recoveryPorts.readRun(currentRunRef);
            return state.status;
          },
          authorized.proof,
          observedStatus,
        );
        expect(outcome.status).toBe('COMMITTED');
      },
      execute: async (next: ControlledFinalRecoveryCommand) => {
        if (next.commandType === 'execution.submit_agent_result' && failBeforeSubmit) {
          failBeforeSubmit = false;
          failedBeforeSubmitKey = next.idempotencyKey;
          throw new Error('injected TE handoff outage before submit');
        }
        const envelope = {
          ...(await scenarioState.firstRunEnvelope(
            next.commandType,
            next.targetRef as unknown as Common.ObjectRef,
            next.payload,
            scenarioState.service,
            next.expectedAggregateVersion,
          )),
          idempotencyKey: next.idempotencyKey,
        };
        let outcome: {
          status: string;
          originalOutcome?: string;
          resultPayload?: CanonicalJsonObject | null;
        };
        switch (next.commandType) {
          case 'execution.submit_agent_result':
            outcome = await scenarioState.restartedEntry.submitAgentResult(
              envelope,
              scenarioState.sessionFor(scenarioState.service),
            );
            break;
          case 'execution.record_run_result':
            outcome = await scenarioState.restartedEntry.recordRunResult(
              envelope,
              scenarioState.sessionFor(scenarioState.service),
            );
            break;
          case 'execution.validate_agent_result':
            outcome = await scenarioState.restartedEntry.validateAgentResult(
              envelope,
              scenarioState.sessionFor(scenarioState.service),
            );
            break;
          case 'execution.accept_agent_result':
            failedKey = next.idempotencyKey;
            outcome = await scenarioState.restartedEntry.acceptAgentResult(
              envelope,
              scenarioState.sessionFor(scenarioState.service),
            );
            break;
          case 'execution.finalize_run_from_acceptance':
            failedKey = next.idempotencyKey;
            outcome = await scenarioState.restartedEntry.finalizeRun(
              envelope,
              scenarioState.sessionFor(scenarioState.service),
            );
            break;
        }
        committedKeys.set(next.commandType, next.idempotencyKey);
        executed.push(next.commandType);
        return outcome;
      },
    };
    if (scenarioState.terminalScenario === 'RECOVERY_MULTIPLE') {
      await recoveryPorts.createProgress({
        runRef: scenarioState.runRef as unknown as CanonicalJsonObject,
        attemptRef: scenarioState.attemptRef as unknown as CanonicalJsonObject,
        sourceRef: scenarioState.finalView.observationRef as unknown as CanonicalJsonObject,
        policyRef: scenarioState.controlsRef as unknown as CanonicalJsonObject,
        runVersion: '2',
      });
      const resultId = record(scenarioState.finalView.agentResultContract).agentResultId;
      if (typeof resultId !== 'string' || scenarioState.observeRecovery === undefined)
        throw new Error('missing multiple Process observer');
      await scenarioState.observeRecovery({
        runRef: scenarioState.runRef,
        attemptRef: scenarioState.attemptRef,
        workOrderRef: scenarioState.workOrderRef,
        resultId,
        scanContext: scenarioState.scanContext,
        ports: recoveryPorts,
        driver: scenarioState.runtimeDriver,
      });
      return true;
    }
    if (scenarioState.terminalScenario === 'RECOVERY_WORKER') {
      const errors: unknown[] = [];
      const worker = createControlledFinalRecoveryWorker({
        taskExecutionDb: scenarioState.guardedTeDb,
        projects: [{ scanContext: scenarioState.scanContext, ports: recoveryPorts }],
        intervalMs: 10,
        maxStepsPerProject: 1,
        onError: (error) => {
          errors.push(error);
        },
      });
      worker.start();
      try {
        const until = Date.now() + 90_000;
        let status = '';
        while (Date.now() < until) {
          const current = await scenarioState.admin.query<{ status: string }>(
            'SELECT status FROM task_execution.run WHERE run_id=$1',
            [scenarioState.runRef.objectId],
          );
          status = current.rows[0]?.status ?? '';
          if (status === 'SUCCEEDED') break;
          await new Promise<void>((resolve) => setTimeout(resolve, 25));
        }
        expect(status).toBe('SUCCEEDED');
      } finally {
        await worker.stop();
      }
      expect(errors).toEqual([]);
      expect(executed).toEqual([
        'execution.submit_agent_result',
        'execution.record_run_result',
        'execution.validate_agent_result',
        'execution.accept_agent_result',
        'execution.finalize_run_from_acceptance',
      ]);
      expect(
        (
          await scenarioState.admin.query<{ count: string }>(
            'SELECT count(*)::text FROM task_execution.process_step WHERE process_id=$1',
            [controlledFinalProcessId(scenarioState.runRef.objectId)],
          )
        ).rows,
      ).toEqual([{ count: '5' }]);
      expect(await recoveryPorts.listProgress()).toEqual([]);
      expect(scenarioState.restartedDriver.invokedAttemptIds).toEqual([]);
      return true;
    }
    const progressGrantId = scenarioState.firstRunGrants.get('runFinalProcessProgressV1');
    const progressBinding = CONTROLLED_FIRST_RUN_BINDINGS.find(
      (binding) => binding.boundary === 'runFinalProcessProgressV1',
    );
    if (progressGrantId === undefined || progressBinding === undefined)
      throw new Error('missing final Process progress Grant');
    expect(
      await scenarioState.revokeCapabilityTracked(
        scenarioState.identityDeps([scenarioState.fixture.projectId], scenarioState.service),
        {
          targetId: progressGrantId,
          expectedAggregateVersion: '1',
          scope: {
            scopeKind: 'PROJECT',
            enterpriseId: scenarioState.fixture.enterpriseId,
            projectId: scenarioState.fixture.projectId,
          },
          reasonCode: 'WI224_REVOKE_FINAL_PROGRESS',
          effectiveAt: new Date(scenarioState.clock),
          idempotencyKey: newUuidV7(),
        },
      ),
    ).toMatchObject({ status: 'COMMITTED' });
    scenarioState.queryReads.length = 0;
    scenarioState.queryWrites.length = 0;
    await expect(
      recoverControlledFinalRuns(scenarioState.teDb, scenarioState.scanContext, recoveryPorts, 1),
    ).rejects.toBeDefined();
    expect(scenarioState.protectedReads(), 'progress Grant revoked').toEqual([]);
    expect(scenarioState.queryWrites, 'progress Grant revoked writes').toEqual([]);
    expect(
      (
        await scenarioState.admin.query<{ count: string }>(
          "SELECT count(*)::text FROM task_execution.process_instance WHERE process_type='controlled-final@1' AND correlation_key=$1",
          [scenarioState.runRef.objectId],
        )
      ).rows,
    ).toEqual([{ count: '0' }]);
    await scenarioState.grant({
      principal: scenarioState.service,
      capabilityCode: scenarioState.firstRunCodes.runFinalProcessProgressV1,
      action: progressBinding.requiredGrantAction,
      selectorType: progressBinding.selectorType,
      targetObjectType: 'zhiju.project.project',
    });
    scenarioState.progressListAuthorization = await scenarioState.progressAuthorization(
      scenarioState.progressListPayload,
    );
    await expect(
      recoverControlledFinalRuns(scenarioState.teDb, scenarioState.scanContext, recoveryPorts, 1),
    ).rejects.toThrow('injected TE handoff outage before submit');
    expect(failedBeforeSubmitKey).toBeDefined();
    expect(await scenarioState.receiptRows(failedBeforeSubmitKey ?? '')).toEqual([]);
    expect(
      (
        await scenarioState.admin.query<{ count: string }>(
          'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
          [scenarioState.runRef.objectId],
        )
      ).rows,
    ).toEqual([{ count: '0' }]);
    expect((await recoveryPorts.listProgress()).map((row) => row.step)).toEqual(['SUBMIT']);
    await expect(
      recoverControlledFinalRuns(scenarioState.teDb, scenarioState.scanContext, recoveryPorts, 1),
    ).rejects.toThrow('injected crash after SUBMIT commit before Process progress');
    const submittedKey = committedKeys.get('execution.submit_agent_result');
    if (submittedKey === undefined) throw new Error('missing committed submit key');
    expect(submittedKey).toBe(failedBeforeSubmitKey);
    expect(await scenarioState.receiptRows(submittedKey)).toHaveLength(1);
    expect(
      (
        await scenarioState.admin.query<{ count: string }>(
          'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
          [scenarioState.runRef.objectId],
        )
      ).rows,
    ).toEqual([{ count: '1' }]);
    expect((await recoveryPorts.listProgress()).map((row) => row.step)).toEqual(['SUBMIT']);
    expect(
      (
        await scenarioState.admin.query<{ count: string }>(
          'SELECT count(*)::text FROM task_execution.process_step WHERE process_id=$1',
          [controlledFinalProcessId(scenarioState.runRef.objectId)],
        )
      ).rows,
    ).toEqual([{ count: '0' }]);
    const pendingProgress = (await recoveryPorts.listProgress())[0];
    if (pendingProgress === undefined) throw new Error('missing pending final Process');
    const forgedSource = structuredClone(pendingProgress.sourceRef);
    record(forgedSource.contentHash).digest = '0'.repeat(64);
    const forgedSourceId = forgedSource.objectId;
    const forgedSourceHash = record(forgedSource.contentHash).digest;
    if (typeof forgedSourceId !== 'string' || typeof forgedSourceHash !== 'string')
      throw new Error('invalid forged source Ref');
    const forgedTransition: ControlledFinalProgressAdvance = {
      expectedStep: 'SUBMIT',
      nextStep: 'RECORD',
      sourceFactRef: forgedSource,
      stableIdempotencyKey: `controlled-final:${forgedSourceId}:${forgedSourceHash}:submit`,
      issuedCommandType: 'execution.submit_agent_result',
      resultRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'execution.agent_result',
        objectId: record(scenarioState.finalView.agentResultContract).agentResultId,
        scope: scenarioState.scope(),
        contentHash: contentHash(
          hashContractPayload(
            record(scenarioState.finalView.agentResultContract) as CanonicalJsonObject,
          ),
        ),
      } as unknown as CanonicalJsonObject,
    };
    const forgedPayload = forgedTransition as unknown as CanonicalJsonObject;
    const forgedAuthorization = await scenarioState.progressAuthorization(forgedPayload);
    await expect(
      advanceControlledFinalProgress(
        scenarioState.guardedTeDb,
        forgedAuthorization.context,
        scenarioState.progressEnvelope(
          forgedAuthorization.context,
          pendingProgress.processId,
          forgedPayload,
          `controlled-final:forged:${newUuidV7()}`,
          pendingProgress.aggregateVersion,
        ),
        forgedTransition,
        forgedAuthorization.proof,
      ),
    ).rejects.toMatchObject({ code: 'CONCURRENCY_CONFLICT' });
    expect((await recoveryPorts.listProgress()).map((row) => row.step)).toEqual(['SUBMIT']);
    const sourceId = pendingProgress.sourceRef.objectId;
    const sourceHash = record(pendingProgress.sourceRef.contentHash).digest;
    if (typeof sourceId !== 'string' || typeof sourceHash !== 'string')
      throw new Error('invalid Process source Ref');
    const validTransition: ControlledFinalProgressAdvance = {
      ...forgedTransition,
      sourceFactRef: pendingProgress.sourceRef,
      stableIdempotencyKey: `controlled-final:${sourceId}:${sourceHash}:submit`,
    };
    const substitutedSourceId = newUuidV7();
    for (const [processId, transition, version] of [
      [newUuidV7(), validTransition, pendingProgress.aggregateVersion],
      [
        pendingProgress.processId,
        {
          ...validTransition,
          expectedStep: 'RECORD',
          nextStep: 'VALIDATE',
          issuedCommandType: 'execution.record_run_result',
          stableIdempotencyKey: `controlled-final:${sourceId}:${sourceHash}:record`,
        },
        pendingProgress.aggregateVersion,
      ],
      [
        pendingProgress.processId,
        validTransition,
        String(Number(pendingProgress.aggregateVersion) + 1),
      ],
      [
        pendingProgress.processId,
        {
          ...validTransition,
          sourceFactRef: {
            ...pendingProgress.sourceRef,
            objectId: substitutedSourceId,
          },
          stableIdempotencyKey: `controlled-final:${substitutedSourceId}:${sourceHash}:submit`,
        },
        pendingProgress.aggregateVersion,
      ],
      [
        pendingProgress.processId,
        {
          ...validTransition,
          sourceFactRef: {
            ...pendingProgress.sourceRef,
            scope: { enterpriseId: scenarioState.fixture.enterpriseId, projectId: newUuidV7() },
          },
        },
        pendingProgress.aggregateVersion,
      ],
    ] as const) {
      const invalidTransition = transition;
      const invalidPayload = invalidTransition as unknown as CanonicalJsonObject;
      const authorized = await scenarioState.progressAuthorization(invalidPayload);
      await expect(
        advanceControlledFinalProgress(
          scenarioState.guardedTeDb,
          authorized.context,
          scenarioState.progressEnvelope(
            authorized.context,
            processId,
            invalidPayload,
            `controlled-final:invalid:${newUuidV7()}`,
            version,
          ),
          invalidTransition,
          authorized.proof,
        ),
      ).rejects.toMatchObject({ code: 'CONCURRENCY_CONFLICT' });
    }
    expect((await recoveryPorts.listProgress()).map((row) => row.step)).toEqual(['SUBMIT']);
    const recoverySteps = ['SUBMIT', 'RECORD', 'VALIDATE', 'ACCEPT', 'FINALIZE'] as const;
    const recoveryCommands = [
      'execution.submit_agent_result',
      'execution.record_run_result',
      'execution.validate_agent_result',
      'execution.accept_agent_result',
      'execution.finalize_run_from_acceptance',
    ] as const;
    for (let step = 0; step < 5; step += 1) {
      if (step === 3) {
        const resultId = String(record(scenarioState.finalView.agentResultContract).agentResultId);
        await scenarioState.admin.query(`
              CREATE OR REPLACE FUNCTION task_execution.wi224_fail_accept_event() RETURNS trigger
              LANGUAGE plpgsql AS $$ BEGIN
                IF NEW.event_type = 'execution.AgentResultAccepted'
                   AND NEW.aggregate_id = '${resultId}'::uuid THEN
                  RAISE EXCEPTION 'injected acceptance outbox failure';
                END IF;
                RETURN NEW;
              END $$`);
        await scenarioState.admin.query(`
              CREATE TRIGGER wi224_fail_accept_event BEFORE INSERT ON task_execution.outbox_event
              FOR EACH ROW EXECUTE FUNCTION task_execution.wi224_fail_accept_event()`);
        try {
          await expect(
            recoverControlledFinalRuns(
              scenarioState.teDb,
              scenarioState.scanContext,
              recoveryPorts,
              1,
            ),
          ).rejects.toBeDefined();
        } finally {
          await scenarioState.admin.query(
            'DROP TRIGGER wi224_fail_accept_event ON task_execution.outbox_event',
          );
          await scenarioState.admin.query('DROP FUNCTION task_execution.wi224_fail_accept_event()');
        }
        expect(failedKey).toBeDefined();
        expect(await scenarioState.receiptRows(failedKey ?? '')).toEqual([]);
        expect(
          (
            await scenarioState.admin.query<{ count: string }>(
              'SELECT count(*)::text FROM task_execution.agent_result_acceptance WHERE result_id=$1',
              [resultId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
        expect(
          (
            await scenarioState.admin.query<{ count: string }>(
              "SELECT count(*)::text FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.AgentResultAccepted'",
              [resultId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
      }
      if (step === 4) {
        const runId = scenarioState.runRef.objectId;
        await scenarioState.admin.query(`
              CREATE OR REPLACE FUNCTION task_execution.wi224_fail_terminal_event() RETURNS trigger
              LANGUAGE plpgsql AS $$ BEGIN
                IF NEW.event_type = 'execution.RunTerminated'
                   AND NEW.aggregate_id = '${runId}'::uuid THEN
                  RAISE EXCEPTION 'injected terminal outbox failure';
                END IF;
                RETURN NEW;
              END $$`);
        await scenarioState.admin.query(`
              CREATE TRIGGER wi224_fail_terminal_event BEFORE INSERT ON task_execution.outbox_event
              FOR EACH ROW EXECUTE FUNCTION task_execution.wi224_fail_terminal_event()`);
        try {
          await expect(
            recoverControlledFinalRuns(
              scenarioState.teDb,
              scenarioState.scanContext,
              recoveryPorts,
              1,
            ),
          ).rejects.toBeDefined();
        } finally {
          await scenarioState.admin.query(
            'DROP TRIGGER wi224_fail_terminal_event ON task_execution.outbox_event',
          );
          await scenarioState.admin.query(
            'DROP FUNCTION task_execution.wi224_fail_terminal_event()',
          );
        }
        expect(failedKey).toBeDefined();
        expect(await scenarioState.receiptRows(failedKey ?? '')).toEqual([]);
        expect(
          (
            await scenarioState.admin.query<{ status: string }>(
              'SELECT status FROM task_execution.run WHERE run_id=$1',
              [runId],
            )
          ).rows,
        ).toEqual([{ status: 'RESULT_RECORDED' }]);
        expect(
          (
            await scenarioState.admin.query<{ status: string }>(
              'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
              [runId],
            )
          ).rows,
        ).toEqual([{ status: 'ACTIVE' }]);
        expect(
          (
            await scenarioState.admin.query<{ count: string }>(
              "SELECT count(*)::text FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.RunTerminated'",
              [runId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
      }
      if (step > 0) {
        const currentStep = recoverySteps[step];
        const commandType = recoveryCommands[step];
        if (currentStep === undefined || commandType === undefined)
          throw new Error('missing recovery step');
        await expect(
          recoverControlledFinalRuns(
            scenarioState.teDb,
            scenarioState.scanContext,
            recoveryPorts,
            1,
          ),
        ).rejects.toThrow(`injected crash after ${currentStep} commit before Process progress`);
        const committedKey = committedKeys.get(commandType);
        if (committedKey === undefined) throw new Error('missing committed recovery key');
        expect(await scenarioState.receiptRows(committedKey)).toHaveLength(1);
        expect((await recoveryPorts.listProgress()).map((row) => row.step)).toEqual([currentStep]);
        expect(
          (
            await scenarioState.admin.query<{ count: string }>(
              'SELECT count(*)::text FROM task_execution.process_step WHERE process_id=$1',
              [controlledFinalProcessId(scenarioState.runRef.objectId)],
            )
          ).rows,
        ).toEqual([{ count: String(step) }]);
      }
      const advanced = await recoverControlledFinalRuns(
        scenarioState.teDb,
        scenarioState.scanContext,
        recoveryPorts,
        1,
      );
      expect(advanced).toBe(1);
    }
    expect(executed).toEqual(recoveryCommands.flatMap((commandType) => [commandType, commandType]));
    expect(
      await recoverControlledFinalRuns(scenarioState.teDb, scenarioState.scanContext, {
        ...recoveryPorts,
        readFinal: () => Promise.reject(new Error('terminal Run must not query IG')),
        execute: () => Promise.reject(new Error('terminal Run must not execute')),
      }),
    ).toBe(0);
    expect(
      await scenarioState.restartedEntry.getRunState(
        await scenarioState.firstRunQuery(
          'execution.get_run_state',
          scenarioState.runRef,
          { runRef: scenarioState.runRef } as unknown as CanonicalJsonObject,
          'runStateReadV1',
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({ status: 'SUCCEEDED' });
    expect(
      (
        await scenarioState.admin.query<{ status: string }>(
          'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
          [scenarioState.runRef.objectId],
        )
      ).rows,
    ).toEqual([{ status: 'RELEASED' }]);
    expect(
      (
        await scenarioState.admin.query<{ event_type: string; count: string }>(
          "SELECT event_type,count(*)::text FROM task_execution.outbox_event WHERE aggregate_id IN ($1,$2) AND event_type IN ('execution.AgentResultAccepted','execution.RunTerminated') GROUP BY event_type ORDER BY event_type",
          [
            scenarioState.runRef.objectId,
            record(scenarioState.finalView.agentResultContract).agentResultId,
          ],
        )
      ).rows,
    ).toEqual([
      { event_type: 'execution.AgentResultAccepted', count: '1' },
      { event_type: 'execution.RunTerminated', count: '1' },
    ]);
    expect(scenarioState.runtimeDriver.invokedAttemptIds).toHaveLength(1);
    expect(scenarioState.restartedDriver.invokedAttemptIds).toEqual([]);
    return true;
  }
  return false;
}
