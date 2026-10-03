import type { createBlockedInputRecoveryEntry } from '@zhiju/api/composition';
import {
  createControlledFirstRunEntry,
  type FormalCompletionEntryConfig,
} from '@zhiju/api/composition';
import type { Common, IntegrationGateway } from '@zhiju/contracts';
import type { EnterpriseProjectDb } from '@zhiju/enterprise-project';
import type { IdentityPolicyRepository } from '@zhiju/identity-policy';
import {
  BLOCKED_INPUT_RECOVERY_BINDINGS,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
} from '@zhiju/identity-policy';
import type {
  InMemoryRenderObjectStorage,
  IntegrationRendererDb,
  LocalSyntheticRuntimeDriver,
} from '@zhiju/integration-gateway';
import { createIntegrationRendererDatabase } from '@zhiju/integration-gateway';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import { createTaskExecutionDatabase, type TaskExecutionDb } from '@zhiju/task-execution';
import type { Kysely, KyselyPlugin } from 'kysely';
import pg from 'pg';
import { expect } from 'vitest';
import { verifyControlledFinalUpgrade } from './controlled-final-upgrade.js';
import {
  definedValue,
  dependencyCapabilities,
  objectRef,
  type Principal,
} from './initial-context-fixtures.js';
import type {
  ScenarioFirstRunCodes,
  ScenarioFirstRunEnvelope,
  ScenarioFirstRunQuery,
  ScenarioRecoveryConfig,
  ScenarioRecoveryEnvelope,
  ScenarioTerminalScenario,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifyHistoricalRunUpgradeContext {
  readonly terminalScenario: ScenarioTerminalScenario;
  readonly phase: InitialContextSuite['phase'];
  readonly prepareIndependentGrants: InitialContextSuite['prepareIndependentGrants'];
  readonly grant: InitialContextSuite['grant'];
  readonly operator: InitialContextSuite['operator'];
  readonly recoveryCodes: Record<string, string>;
  readonly recoveryEnvelope: ScenarioRecoveryEnvelope;
  readonly workOrderRef: Common.ObjectRef;
  readonly runRef: Common.ObjectRef;
  readonly controlsRef: Common.VersionedRef;
  readonly recoveryEntryRaw: ReturnType<typeof createBlockedInputRecoveryEntry>;
  readonly sessionFor: InitialContextSuite['sessionFor'];
  readonly receiptRows: InitialContextSuite['receiptRows'];
  admin: InitialContextSuite['admin'];
  readonly woId: string;
  fixture: InitialContextSuite['fixture'];
  clock: InitialContextSuite['clock'];
  enterpriseProjectDb: InitialContextSuite['enterpriseProjectDb'];
  identityDb: InitialContextSuite['identityDb'];
  identityRepo: InitialContextSuite['identityRepo'];
  readonly crypto: InitialContextSuite['crypto'];
  tePool: InitialContextSuite['tePool'];
  readonly queryProbe: KyselyPlugin;
  readonly runtimeDriver: LocalSyntheticRuntimeDriver;
  readonly runtimeJournal: InMemoryRenderObjectStorage;
  readonly firstRunCodes: ScenarioFirstRunCodes;
  readonly bounded: boolean;
  readonly recoveryConfig: ScenarioRecoveryConfig;
  readonly firstRunQuery: ScenarioFirstRunQuery;
  service: Principal;
  readonly attemptRef: Common.ObjectRef;
  readonly firstRunEnvelope: ScenarioFirstRunEnvelope;
  readonly scope: InitialContextSuite['scope'];
  readonly runDeadline: Date;
  readonly waitForDeadline: InitialContextSuite['waitForDeadline'];
  readonly firstRunConfig: {
    capabilities: {
      readonly resolvePolicy: 'wi216.cap.resolve';
      readonly readContextSourceSlice: 'wi216.cap.sliceread';
    };
    now: () => Date;
    recovery?: {
      recoveryCapabilityCodes: Record<string, string>;
      humanCapabilityCodes: { answerSubmit: string; requestResolve: string; materialRead: string };
    };
    taskExecutionDb: Kysely<TaskExecutionDb>;
    enterpriseProjectDb: Kysely<EnterpriseProjectDb>;
    identity: {
      db: Kysely<IdentityPolicyDb>;
      repo: IdentityPolicyRepository;
      crypto: IdentityCryptoPorts;
    };
    integrationGatewayDb: Kysely<IntegrationRendererDb>;
    runtimeDriver: LocalSyntheticRuntimeDriver;
    receiptStorage: InMemoryRenderObjectStorage;
    capabilityCodes: ScenarioFirstRunCodes;
    formalCompletion?: FormalCompletionEntryConfig;
  };
  readonly contextRef: Common.SnapshotRef;
  readonly dispatched: IntegrationGateway.IntegrationGetRuntimeAttemptBindingResult;
  readonly guardedTeDb: Kysely<TaskExecutionDb>;
  readonly firstRunEntry: ReturnType<typeof createControlledFirstRunEntry>;
}

export async function verifyHistoricalRunUpgrade(
  scenarioState: VerifyHistoricalRunUpgradeContext,
): Promise<boolean> {
  if (scenarioState.terminalScenario === 'LEGACY_UPGRADE') {
    scenarioState.phase('historical Run backup/upgrade');
    let upgradeFailure: unknown;
    let legacyUpgradeResult: Promise<PromiseSettledResult<void>> | undefined;
    try {
      const legacyBindings = BLOCKED_INPUT_RECOVERY_BINDINGS.filter(
        (binding) =>
          binding.capabilityConfigKey === 'workOrderRetryScheduleV1' ||
          binding.capabilityConfigKey.startsWith('recovery.retry_schedule.'),
      );
      await scenarioState.prepareIndependentGrants(legacyBindings, async (binding) => {
        await scenarioState.grant({
          principal: scenarioState.operator(),
          capabilityCode: definedValue(scenarioState.recoveryCodes[binding.capabilityConfigKey]),
          action: binding.requiredGrantAction,
          selectorType: binding.selectorType,
          targetObjectType: definedValue(binding.targetObjectTypes[0]),
          targetObjectTypes: binding.targetObjectTypes,
        });
      });
      const legacyRetry = await scenarioState.recoveryEnvelope(
        'workOrderRetryScheduleV1',
        scenarioState.workOrderRef,
        {
          previousRunRef: scenarioState.runRef,
          nextAttemptNumber: 2,
          retryReason: 'BLOCKED_INPUT_RESOLVED',
          retryPolicyRef: scenarioState.controlsRef,
        } as unknown as CanonicalJsonObject,
        scenarioState.operator(),
        4,
      );
      await expect(
        scenarioState.recoveryEntryRaw.command(legacyRetry, scenarioState.sessionFor()),
      ).rejects.toMatchObject({
        code: 'EXECUTION_CRITERION_UNSUPPORTED',
      });
      expect(await scenarioState.receiptRows(String(legacyRetry.idempotencyKey))).toEqual([]);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT intent_id FROM task_execution.work_order_retry_intent WHERE work_order_id=$1',
            [scenarioState.woId],
          )
        ).rows,
      ).toEqual([]);
      // Check the old Adapter binding before the finite deadline; the clone's
      // owning expiry can wait while independent historical backups proceed.
      let signalLegacyChecked: (() => void) | undefined;
      const legacyChecked = new Promise<void>((resolve) => {
        signalLegacyChecked = resolve;
      });
      legacyUpgradeResult = verifyControlledFinalUpgrade(scenarioState.admin, {
        schema: 'task_execution',
        version: '3006',
        enterpriseId: scenarioState.fixture.enterpriseId,
        requiredTables: [
          'execution_judgment',
          'work_order_draft_snapshot',
          'context_snapshot',
          'work_order_contract',
          'run',
          'work_order_run_claim',
        ],
        afterMigrate: async (legacyAdmin, connectionUri) => {
          await legacyAdmin.query(
            "CREATE ROLE wi224_legacy_probe LOGIN PASSWORD 'wi224-legacy-probe' NOSUPERUSER NOBYPASSRLS",
          );
          await legacyAdmin.query(
            'GRANT platform_context_establisher, task_execution_app TO wi224_legacy_probe',
          );
          const url = new URL(connectionUri);
          url.username = 'wi224_legacy_probe';
          url.password = 'wi224-legacy-probe';
          const pool = new pg.Pool({ connectionString: url.toString(), max: 3 });
          const previousClock = scenarioState.clock;
          try {
            const legacyDb = createTaskExecutionDatabase(pool);
            const legacyEntry = createControlledFirstRunEntry({
              taskExecutionDb: legacyDb,
              enterpriseProjectDb: scenarioState.enterpriseProjectDb,
              identity: {
                db: scenarioState.identityDb,
                repo: scenarioState.identityRepo,
                crypto: scenarioState.crypto,
              },
              integrationGatewayDb: createIntegrationRendererDatabase(
                scenarioState.tePool,
              ).withPlugin(scenarioState.queryProbe),
              runtimeDriver: scenarioState.runtimeDriver,
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
            const query = await scenarioState.firstRunQuery(
              'execution.get_run_state',
              scenarioState.runRef,
              { runRef: scenarioState.runRef } as unknown as CanonicalJsonObject,
              'runStateReadV1',
            );
            expect(
              await legacyEntry.getRunState(query, scenarioState.sessionFor(scenarioState.service)),
            ).toMatchObject({
              status: 'RUNNING',
              aggregateVersion: 2,
            });
            const actual = await scenarioState.runtimeDriver.readFinal(scenarioState.attemptRef);
            if (actual === undefined)
              throw new Error('missing current Driver source for legacy refusal');
            const body = actual.agentResultContract;
            if (typeof body.agentResultId !== 'string') throw new Error('missing actual Result ID');
            const attemptSubmit = await scenarioState.firstRunEnvelope(
              'execution.submit_agent_result',
              objectRef(
                'execution.agent_result',
                body.agentResultId,
                scenarioState.scope(),
              ) as Common.ObjectRef,
              {
                agentResultContract: body,
                runFencingToken: 1,
                runtimeSubmissionRef: actual.runtimeSubmissionRef,
              } as unknown as CanonicalJsonObject,
              scenarioState.service,
            );
            await expect(
              legacyEntry.submitAgentResult(
                attemptSubmit,
                scenarioState.sessionFor(scenarioState.service),
              ),
            ).rejects.toMatchObject({ code: 'REFERENCE_INVALID' });
            expect(
              (
                await legacyAdmin.query<{ count: string }>(
                  'SELECT count(*)::text FROM task_execution.agent_result',
                )
              ).rows,
            ).toEqual([{ count: '0' }]);
            if (signalLegacyChecked === undefined) throw new Error('missing V3006 check signal');
            signalLegacyChecked();
            const wait = Math.max(0, scenarioState.runDeadline.getTime() - Date.now() + 100);
            if (wait > 0) await scenarioState.waitForDeadline(wait, 'server deadline/wait');
            scenarioState.clock = Date.now();
            expect(
              (
                await legacyAdmin.query<{ expired: boolean }>(
                  'SELECT clock_timestamp() >= execution_deadline AS expired FROM task_execution.run WHERE run_id=$1',
                  [scenarioState.runRef.objectId],
                )
              ).rows,
            ).toEqual([{ expired: true }]);
            const expire = await scenarioState.firstRunEnvelope(
              'execution.expire_run',
              scenarioState.runRef,
              { reason: 'DEADLINE_EXCEEDED' },
              scenarioState.service,
              2,
            );
            expect(
              await legacyEntry.expireRun(expire, scenarioState.sessionFor(scenarioState.service)),
            ).toMatchObject({
              status: 'COMMITTED',
            });
            expect(
              (
                await legacyAdmin.query<{ status: string; identity: unknown }>(
                  'SELECT status,runtime_adapter_identity_ref AS identity FROM task_execution.run WHERE run_id=$1',
                  [scenarioState.runRef.objectId],
                )
              ).rows,
            ).toEqual([{ status: 'TIMED_OUT', identity: null }]);
            expect(
              (
                await legacyAdmin.query<{ status: string }>(
                  'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
                  [scenarioState.runRef.objectId],
                )
              ).rows,
            ).toEqual([{ status: 'EXPIRED' }]);
          } finally {
            scenarioState.clock = Math.max(scenarioState.clock, previousClock);
            await pool.end();
          }
        },
      }).then(
        () => ({ status: 'fulfilled' as const, value: undefined }),
        (reason: unknown) => ({ status: 'rejected' as const, reason }),
      );
      await Promise.race([
        legacyChecked,
        legacyUpgradeResult.then((result) => {
          if (result.status === 'rejected') throw result.reason;
          throw new Error('V3006 upgrade finished before the refusal check');
        }),
      ]);
      // Restore actual one-attempt facts from both deployed baselines before adding recovery storage.
      const recentBackups = await Promise.allSettled(
        (['3010', '7004'] as const).map(async (version) => {
          await verifyControlledFinalUpgrade(scenarioState.admin, {
            schema: 'task_execution',
            version,
            enterpriseId: scenarioState.fixture.enterpriseId,
            requiredTables: [
              'task',
              'work_order',
              'work_order_contract',
              'context_snapshot',
              'run',
              'work_order_run_claim',
              'command_receipt',
            ],
            afterMigrate: async (legacyAdmin, connectionUri) => {
              await legacyAdmin.query(
                "CREATE ROLE wi231_upgrade_probe LOGIN PASSWORD 'wi231-upgrade-probe' NOSUPERUSER NOBYPASSRLS",
              );
              await legacyAdmin.query(
                'GRANT platform_context_establisher, task_execution_app TO wi231_upgrade_probe',
              );
              const url = new URL(connectionUri);
              url.username = 'wi231_upgrade_probe';
              url.password = 'wi231-upgrade-probe';
              const pool = new pg.Pool({ connectionString: url.toString(), max: 3 });
              try {
                const restored = createControlledFirstRunEntry({
                  ...scenarioState.firstRunConfig,
                  taskExecutionDb: createTaskExecutionDatabase(pool),
                });
                expect(
                  await restored.getRunState(
                    await scenarioState.firstRunQuery(
                      'execution.get_run_state',
                      scenarioState.runRef,
                      { runRef: scenarioState.runRef } as unknown as CanonicalJsonObject,
                      'runStateReadV1',
                    ),
                    scenarioState.sessionFor(scenarioState.service),
                  ),
                ).toMatchObject({
                  status: 'RUNNING',
                  aggregateVersion: 2,
                  contextSnapshotRef: scenarioState.contextRef,
                });
              } finally {
                await pool.end();
              }
            },
          });
        }),
      );
      for (const backup of recentBackups) if (backup.status === 'rejected') throw backup.reason;
      await verifyControlledFinalUpgrade(scenarioState.admin, {
        schema: 'integration_gateway',
        version: '7004',
        enterpriseId: scenarioState.fixture.enterpriseId,
        requiredTables: [
          'runtime_attempt',
          'runtime_adapter_identity',
          'runtime_attempt_observation',
          'raw_external_receipt',
          'command_receipt',
        ],
        afterMigrate: async (legacyAdmin, connectionUri) => {
          await legacyAdmin.query(
            "CREATE ROLE wi231_upgrade_ig LOGIN PASSWORD 'wi231-upgrade-ig' NOSUPERUSER NOBYPASSRLS",
          );
          await legacyAdmin.query(
            'GRANT platform_context_establisher, integration_gateway_app TO wi231_upgrade_ig',
          );
          const url = new URL(connectionUri);
          url.username = 'wi231_upgrade_ig';
          url.password = 'wi231-upgrade-ig';
          const pool = new pg.Pool({ connectionString: url.toString(), max: 3 });
          try {
            const restored = createControlledFirstRunEntry({
              ...scenarioState.firstRunConfig,
              integrationGatewayDb: createIntegrationRendererDatabase(pool),
            });
            expect(
              await restored.getRuntimeAttemptBinding(
                await scenarioState.firstRunQuery(
                  'integration.get_runtime_attempt_binding',
                  scenarioState.attemptRef,
                  { attemptRef: scenarioState.attemptRef } as unknown as CanonicalJsonObject,
                  'runtimeAttemptBindingReadV1',
                ),
                scenarioState.sessionFor(scenarioState.service),
              ),
            ).toEqual(scenarioState.dispatched);
          } finally {
            await pool.end();
          }
        },
      });

      const legacyUpgrade = await legacyUpgradeResult;
      if (legacyUpgrade.status === 'rejected') throw legacyUpgrade.reason;
      await verifyControlledFinalUpgrade(scenarioState.admin, {
        schema: 'integration_gateway',
        version: '7002',
        enterpriseId: scenarioState.fixture.enterpriseId,
        requiredTables: [
          'runtime_attempt',
          'runtime_attempt_observation',
          'raw_external_receipt',
          'command_receipt',
        ],
        afterMigrate: async (legacyAdmin, connectionUri) => {
          await legacyAdmin.query(
            "CREATE ROLE wi224_legacy_ig LOGIN PASSWORD 'wi224-legacy-ig' NOSUPERUSER NOBYPASSRLS",
          );
          await legacyAdmin.query(
            'GRANT platform_context_establisher, integration_gateway_app TO wi224_legacy_ig',
          );
          const url = new URL(connectionUri);
          url.username = 'wi224_legacy_ig';
          url.password = 'wi224-legacy-ig';
          const pool = new pg.Pool({ connectionString: url.toString(), max: 3 });
          try {
            const legacyEntry = createControlledFirstRunEntry({
              taskExecutionDb: scenarioState.guardedTeDb,
              enterpriseProjectDb: scenarioState.enterpriseProjectDb,
              identity: {
                db: scenarioState.identityDb,
                repo: scenarioState.identityRepo,
                crypto: scenarioState.crypto,
              },
              integrationGatewayDb: createIntegrationRendererDatabase(pool),
              runtimeDriver: scenarioState.runtimeDriver,
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
            expect(
              await legacyEntry.getRuntimeAttemptBinding(
                await scenarioState.firstRunQuery(
                  'integration.get_runtime_attempt_binding',
                  scenarioState.attemptRef,
                  { attemptRef: scenarioState.attemptRef } as unknown as CanonicalJsonObject,
                  'runtimeAttemptBindingReadV1',
                ),
                scenarioState.sessionFor(scenarioState.service),
              ),
            ).toEqual(scenarioState.dispatched);
            await expect(
              legacyEntry.getRuntimeFinalObservation(
                await scenarioState.firstRunQuery(
                  'integration.get_runtime_final_observation',
                  scenarioState.attemptRef,
                  { attemptRef: scenarioState.attemptRef } as unknown as CanonicalJsonObject,
                  'runtimeFinalReadV1',
                ),
                scenarioState.sessionFor(scenarioState.service),
              ),
            ).rejects.toMatchObject({ code: 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND' });
          } finally {
            await pool.end();
          }
        },
      });
    } catch (error) {
      if (legacyUpgradeResult !== undefined) await legacyUpgradeResult;
      upgradeFailure = error;
    }
    // Always close this source through the owning expiry path, including a
    // failed backup assertion, so it cannot poison later project scans.
    const cleanupWait = Math.max(0, scenarioState.runDeadline.getTime() - Date.now() + 100);
    if (cleanupWait > 0)
      await scenarioState.waitForDeadline(cleanupWait, 'server deadline/cleanupWait');
    scenarioState.clock = Date.now();
    const expireSource = await scenarioState.firstRunEnvelope(
      'execution.expire_run',
      scenarioState.runRef,
      { reason: 'DEADLINE_EXCEEDED' },
      scenarioState.service,
      2,
    );
    expect(
      await scenarioState.firstRunEntry.expireRun(
        expireSource,
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({
      status: 'COMMITTED',
    });
    expect(scenarioState.runtimeDriver.invokedAttemptIds).toEqual([
      scenarioState.attemptRef.objectId,
    ]);
    if (upgradeFailure !== undefined)
      throw upgradeFailure instanceof Error
        ? upgradeFailure
        : new Error('historical upgrade failed', { cause: upgradeFailure });
    return true;
  }
  return false;
}
