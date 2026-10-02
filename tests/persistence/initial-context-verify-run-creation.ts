import { createControlledFirstRunEntry } from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import {
  createIntegrationRendererDatabase,
  InMemoryRenderObjectStorage,
  LocalSyntheticRuntimeDriver,
} from '@zhiju/integration-gateway';
import { type CanonicalJsonObject, newUuidV7 } from '@zhiju/shared-kernel';
import type { TaskExecutionDb } from '@zhiju/task-execution';
import type { Kysely, KyselyPlugin } from 'kysely';
import { expect } from 'vitest';
import {
  contentHash,
  dependencyCapabilities,
  objectRef,
  type Principal,
} from './initial-context-fixtures.js';
import type {
  ScenarioFirstRunCodes,
  ScenarioFirstRunEnvelope,
  ScenarioFirstRunQuery,
  ScenarioRead,
  ScenarioRecoveryConfig,
  ScenarioRuntimeBinding,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifyRunCreationContext {
  readonly exercisePreparationMatrix: boolean;
  readonly scope: InitialContextSuite['scope'];
  readonly guardedTeDb: Kysely<TaskExecutionDb>;
  enterpriseProjectDb: InitialContextSuite['enterpriseProjectDb'];
  identityDb: InitialContextSuite['identityDb'];
  identityRepo: InitialContextSuite['identityRepo'];
  readonly crypto: InitialContextSuite['crypto'];
  tePool: InitialContextSuite['tePool'];
  readonly queryProbe: KyselyPlugin;
  readonly firstRunCodes: ScenarioFirstRunCodes;
  readonly bounded: boolean;
  readonly recoveryCodes: Record<string, string>;
  readonly recoveryConfig: ScenarioRecoveryConfig;
  clock: InitialContextSuite['clock'];
  readonly firstRunEnvelope: ScenarioFirstRunEnvelope;
  readonly workOrderRef: Common.ObjectRef;
  readonly runRef: Common.ObjectRef;
  readonly read: ScenarioRead;
  readonly contextRef: Common.SnapshotRef;
  readonly bundleRef: unknown;
  readonly runtimeBinding: ScenarioRuntimeBinding;
  service: Principal;
  readonly sessionFor: InitialContextSuite['sessionFor'];
  readonly firstRunEntry: ReturnType<typeof createControlledFirstRunEntry>;
  readonly firstRunQuery: ScenarioFirstRunQuery;
  readonly runtimeDriver: LocalSyntheticRuntimeDriver;
}

export async function verifyRunCreation(scenarioState: VerifyRunCreationContext): Promise<boolean> {
  if (scenarioState.exercisePreparationMatrix) {
    for (const invalidAck of ['INSTANCE_ID', 'BINDING_HASH'] as const) {
      const invalidAttemptRef = objectRef(
        'integration.runtime_attempt',
        newUuidV7(),
        scenarioState.scope(),
      ) as Common.ObjectRef;
      const invalidJournal = new InMemoryRenderObjectStorage();
      const invokedDriver = new LocalSyntheticRuntimeDriver(undefined, invalidJournal);
      const invalidEntry = createControlledFirstRunEntry({
        taskExecutionDb: scenarioState.guardedTeDb,
        enterpriseProjectDb: scenarioState.enterpriseProjectDb,
        identity: {
          db: scenarioState.identityDb,
          repo: scenarioState.identityRepo,
          crypto: scenarioState.crypto,
        },
        integrationGatewayDb: createIntegrationRendererDatabase(scenarioState.tePool).withPlugin(
          scenarioState.queryProbe,
        ),
        runtimeDriver: {
          invoke: async (input) => {
            const ack = await invokedDriver.invoke(input);
            return invalidAck === 'INSTANCE_ID'
              ? {
                  ...ack,
                  runtimeAdapterIdentityRef: {
                    ...ack.runtimeAdapterIdentityRef,
                    objectId: newUuidV7(),
                  },
                }
              : { ...ack, bindingHash: contentHash('0'.repeat(64)) };
          },
          readBack: (ref) => invokedDriver.readBack(ref),
          readFinal: (ref) => invokedDriver.readFinal(ref),
        },
        receiptStorage: invalidJournal,
        capabilityCodes: scenarioState.firstRunCodes,
        ...(scenarioState.bounded
          ? {
              recovery: {
                recoveryCapabilityCodes: scenarioState.recoveryCodes,
                humanCapabilityCodes: scenarioState.recoveryConfig.humanCapabilityCodes,
              },
            }
          : {}),
        capabilities: dependencyCapabilities,
        now: () => new Date(scenarioState.clock),
      });
      const invalidDispatch = await scenarioState.firstRunEnvelope(
        'integration.request_runtime_dispatch',
        invalidAttemptRef,
        {
          request: {
            workOrderRef: scenarioState.workOrderRef,
            runRef: scenarioState.runRef,
            workOrderContractRef: scenarioState.read.contractRef,
            contextSnapshotRef: scenarioState.contextRef,
            capabilityGrantRef: scenarioState.bundleRef,
            runtimeBinding: scenarioState.runtimeBinding,
            stableIdempotencyKey: newUuidV7(),
            requestedAt: new Date(scenarioState.clock).toISOString(),
          },
        } as unknown as CanonicalJsonObject,
        scenarioState.service,
      );
      await expect(
        invalidEntry.dispatch(invalidDispatch, scenarioState.sessionFor(scenarioState.service)),
      ).rejects.toBeDefined();
      const invalidBinding = await scenarioState.firstRunEntry.getRuntimeAttemptBinding(
        await scenarioState.firstRunQuery(
          'integration.get_runtime_attempt_binding',
          invalidAttemptRef,
          { attemptRef: invalidAttemptRef } as unknown as CanonicalJsonObject,
          'runtimeAttemptBindingReadV1',
        ),
        scenarioState.sessionFor(scenarioState.service),
      );
      expect(invalidBinding.status).toBe('CREATED');
      expect(invalidBinding.acknowledgement).toBeUndefined();
      await expect(
        scenarioState.firstRunEntry.getRuntimeFinalObservation(
          await scenarioState.firstRunQuery(
            'integration.get_runtime_final_observation',
            invalidAttemptRef,
            { attemptRef: invalidAttemptRef } as unknown as CanonicalJsonObject,
            'runtimeFinalReadV1',
          ),
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).rejects.toMatchObject({ code: 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND' });
      expect(invokedDriver.invokedAttemptIds).toEqual([invalidAttemptRef.objectId]);
      expect(scenarioState.runtimeDriver.invokedAttemptIds).toEqual([]);
    }
    const wrongProfileAttempt = objectRef(
      'integration.runtime_attempt',
      newUuidV7(),
      scenarioState.scope(),
    ) as Common.ObjectRef;
    const wrongProfileDispatch = await scenarioState.firstRunEnvelope(
      'integration.request_runtime_dispatch',
      wrongProfileAttempt,
      {
        request: {
          workOrderRef: scenarioState.workOrderRef,
          runRef: scenarioState.runRef,
          workOrderContractRef: scenarioState.read.contractRef,
          contextSnapshotRef: scenarioState.contextRef,
          capabilityGrantRef: scenarioState.bundleRef,
          runtimeBinding: {
            ...scenarioState.runtimeBinding,
            adapterCode: 'te.human_operated.other',
          },
          stableIdempotencyKey: newUuidV7(),
          requestedAt: new Date(scenarioState.clock).toISOString(),
        },
      } as unknown as CanonicalJsonObject,
      scenarioState.service,
    );
    await expect(
      scenarioState.firstRunEntry.dispatch(
        wrongProfileDispatch,
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).rejects.toBeDefined();
    expect(scenarioState.runtimeDriver.invokedAttemptIds).toEqual([]);
  }
  return false;
}
