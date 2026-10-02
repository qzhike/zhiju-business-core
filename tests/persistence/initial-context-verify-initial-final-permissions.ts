import { createControlledFirstRunEntry } from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import type {
  InMemoryRenderObjectStorage,
  LocalSyntheticRuntimeDriver,
} from '@zhiju/integration-gateway';
import {
  createIntegrationRendererDatabase,
  withRenderTransaction,
} from '@zhiju/integration-gateway';
import { type CanonicalJsonObject, hashContractPayload, newUuidV7 } from '@zhiju/shared-kernel';
import type { TaskExecutionDb } from '@zhiju/task-execution';
import { type Kysely, type KyselyPlugin, sql } from 'kysely';
import { expect } from 'vitest';
import {
  contentHash,
  dependencyCapabilities,
  type Principal,
  record,
} from './initial-context-fixtures.js';
import type {
  ScenarioFinalQuery,
  ScenarioFinalView,
  ScenarioFirstRunCodes,
  ScenarioRecoveryConfig,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifyInitialFinalPermissionsContext {
  readonly exercisePreparationMatrix: boolean;
  readonly observingDriver: LocalSyntheticRuntimeDriver;
  readonly attemptRef: Common.ObjectRef;
  readonly registry: InitialContextSuite['registry'];
  fixture: InitialContextSuite['fixture'];
  readonly guardedTeDb: Kysely<TaskExecutionDb>;
  enterpriseProjectDb: InitialContextSuite['enterpriseProjectDb'];
  identityDb: InitialContextSuite['identityDb'];
  identityRepo: InitialContextSuite['identityRepo'];
  readonly crypto: InitialContextSuite['crypto'];
  tePool: InitialContextSuite['tePool'];
  readonly queryProbe: KyselyPlugin;
  readonly runtimeJournal: InMemoryRenderObjectStorage;
  readonly firstRunCodes: ScenarioFirstRunCodes;
  readonly bounded: boolean;
  readonly recoveryCodes: Record<string, string>;
  readonly recoveryConfig: ScenarioRecoveryConfig;
  clock: InitialContextSuite['clock'];
  readonly finalQuery: ScenarioFinalQuery;
  readonly sessionFor: InitialContextSuite['sessionFor'];
  service: Principal;
  readonly firstRunEntry: ReturnType<typeof createControlledFirstRunEntry>;
  readonly finalView: ScenarioFinalView;
  readonly runtimeDriver: LocalSyntheticRuntimeDriver;
  admin: InitialContextSuite['admin'];
  readonly runnerContext: InitialContextSuite['runnerContext'];
}

export async function verifyInitialFinalPermissions(
  scenarioState: VerifyInitialFinalPermissionsContext,
): Promise<boolean> {
  if (scenarioState.exercisePreparationMatrix) {
    const originalFinal = await scenarioState.observingDriver.readFinal(scenarioState.attemptRef);
    if (originalFinal === undefined) throw new Error('missing synthetic final');
    const changedBody = {
      ...originalFinal.agentResultContract,
      humanSummary: 'A different final from the same Attempt.',
    };
    const conflictingBody = {
      ...changedBody,
      header: {
        ...record(originalFinal.agentResultContract.header),
        payloadHash: contentHash(hashContractPayload(changedBody)),
      },
    } as unknown as CanonicalJsonObject;
    const changedRunBody = {
      ...originalFinal.agentResultContract,
      runRef: {
        ...record(originalFinal.agentResultContract.runRef),
        objectId: newUuidV7(),
      },
    };
    const conflictingRunBody = {
      ...changedRunBody,
      header: {
        ...record(originalFinal.agentResultContract.header),
        payloadHash: contentHash(hashContractPayload(changedRunBody)),
      },
    } as unknown as CanonicalJsonObject;
    expect(
      scenarioState.registry.validateCoreContract(
        'https://schemas.zhiju.local/core/agent-result/1.0',
        conflictingRunBody,
      ).valid,
    ).toBe(true);
    for (const conflictingFinal of [
      { ...originalFinal, attemptRef: { ...scenarioState.attemptRef, objectId: newUuidV7() } },
      {
        ...originalFinal,
        attemptRef: {
          ...scenarioState.attemptRef,
          scope: { enterpriseId: scenarioState.fixture.enterpriseId, projectId: newUuidV7() },
        },
      },
      {
        ...originalFinal,
        runtimeAdapterIdentityRef: {
          ...originalFinal.runtimeAdapterIdentityRef,
          objectId: newUuidV7(),
        },
      },
      {
        ...originalFinal,
        runtimeAdapterIdentityRef: {
          ...originalFinal.runtimeAdapterIdentityRef,
          scope: { enterpriseId: scenarioState.fixture.enterpriseId, projectId: newUuidV7() },
        },
      },
      { ...originalFinal, bindingHash: contentHash('0'.repeat(64)) },
      { ...originalFinal, runFencingToken: originalFinal.runFencingToken + 1 },
      { ...originalFinal, agentResultContract: conflictingBody },
      { ...originalFinal, agentResultContract: conflictingRunBody },
    ]) {
      const conflictingFinalEntry = createControlledFirstRunEntry({
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
          invoke: () => Promise.reject(new Error('unexpected second synthetic invocation')),
          readBack: (ref) => scenarioState.observingDriver.readBack(ref),
          readFinal: () => Promise.resolve(conflictingFinal),
        },
        receiptStorage: scenarioState.runtimeJournal,
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
      await expect(
        conflictingFinalEntry.observeRuntimeFinal(
          scenarioState.finalQuery,
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).rejects.toBeDefined();
      expect(
        await scenarioState.firstRunEntry.getRuntimeFinalObservation(
          scenarioState.finalQuery,
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).toEqual(scenarioState.finalView);
    }
    expect(scenarioState.runtimeDriver.invokedAttemptIds).toEqual([
      scenarioState.attemptRef.objectId,
    ]);
    const igDb = createIntegrationRendererDatabase(scenarioState.tePool);
    await scenarioState.admin.query('BEGIN');
    try {
      await scenarioState.admin.query('SET LOCAL ROLE integration_gateway_app');
      expect(
        (
          await scenarioState.admin.query(
            'SELECT instance_id FROM integration_gateway.runtime_adapter_identity WHERE instance_id=$1',
            [scenarioState.finalView.runtimeAdapterIdentityRef.objectId],
          )
        ).rows,
      ).toEqual([]);
    } finally {
      await scenarioState.admin.query('ROLLBACK');
    }
    await scenarioState.admin.query('BEGIN');
    try {
      await scenarioState.admin.query('SET LOCAL ROLE integration_gateway_app');
      expect(
        (
          await scenarioState.admin.query(
            'SELECT observation_id FROM integration_gateway.runtime_final_observation WHERE observation_id=$1',
            [scenarioState.finalView.observationRef.objectId],
          )
        ).rows,
      ).toEqual([]);
    } finally {
      await scenarioState.admin.query('ROLLBACK');
    }
    for (const [table, idColumn, id] of [
      [
        'runtime_adapter_identity',
        'instance_id',
        scenarioState.finalView.runtimeAdapterIdentityRef.objectId,
      ],
      [
        'runtime_final_observation',
        'observation_id',
        scenarioState.finalView.observationRef.objectId,
      ],
    ] as const) {
      const tableName = `integration_gateway.${table}`;
      const hidden = await withRenderTransaction(
        igDb,
        { ...scenarioState.runnerContext(scenarioState.service), allowedProjectIds: [newUuidV7()] },
        (trx) =>
          sql`SELECT ${sql.ref(idColumn)} FROM ${sql.table(tableName)} WHERE ${sql.ref(idColumn)}=${id}::uuid`.execute(
            trx,
          ),
      );
      expect(hidden.rows).toEqual([]);
      await expect(
        withRenderTransaction(igDb, scenarioState.runnerContext(scenarioState.service), (trx) =>
          sql`UPDATE ${sql.table(tableName)} SET ${sql.ref(idColumn)}=${sql.ref(idColumn)} WHERE ${sql.ref(idColumn)}=${id}::uuid`.execute(
            trx,
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        withRenderTransaction(igDb, scenarioState.runnerContext(scenarioState.service), (trx) =>
          sql`DELETE FROM ${sql.table(tableName)} WHERE ${sql.ref(idColumn)}=${id}::uuid`.execute(
            trx,
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        scenarioState.admin.query(
          `UPDATE ${tableName} SET ${idColumn}=${idColumn} WHERE ${idColumn}=$1`,
          [id],
        ),
      ).rejects.toMatchObject({ code: '55000' });
    }
    await expect(
      scenarioState.admin.query(
        `INSERT INTO integration_gateway.runtime_adapter_identity
              (instance_id,attempt_id,enterprise_id,project_id,adapter_code,adapter_version,
               binding_hash,ack_observation_id,source,source_command_id,canonical_payload,payload_hash)
             SELECT $2::uuid,attempt_id,enterprise_id,project_id,adapter_code,adapter_version,
                    binding_hash,ack_observation_id,source,source_command_id,canonical_payload,payload_hash
               FROM integration_gateway.runtime_adapter_identity WHERE instance_id=$1`,
        [scenarioState.finalView.runtimeAdapterIdentityRef.objectId, newUuidV7()],
      ),
    ).rejects.toMatchObject({ code: '22023' });
    expect(
      (
        await scenarioState.admin.query<{ count: string }>(
          'SELECT count(*)::text FROM integration_gateway.runtime_adapter_identity WHERE attempt_id=$1',
          [scenarioState.attemptRef.objectId],
        )
      ).rows,
    ).toEqual([{ count: '1' }]);
  }
  return false;
}
