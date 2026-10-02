import { createControlledFirstRunEntry } from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import {
  createIntegrationRendererDatabase,
  InMemoryRenderObjectStorage,
  LocalSyntheticRuntimeDriver,
} from '@zhiju/integration-gateway';
import { newUuidV7 } from '@zhiju/shared-kernel';
import type { TaskExecutionDb } from '@zhiju/task-execution';
import type { Kysely, KyselyPlugin } from 'kysely';
import { expect } from 'vitest';
import {
  dependencyCapabilities,
  objectRef,
  type Principal,
  record,
} from './initial-context-fixtures.js';
import type {
  ScenarioFirstRunCodes,
  ScenarioFirstRunEnvelope,
  ScenarioRecoveryConfig,
  ScenarioStartEnvelope,
  ScenarioTerminalScenario,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifyRuntimeDispatchContext {
  readonly terminalScenario: ScenarioTerminalScenario;
  readonly createEnvelope: ScenarioStartEnvelope;
  readonly scope: InitialContextSuite['scope'];
  clock: InitialContextSuite['clock'];
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
  readonly firstRunEnvelope: ScenarioFirstRunEnvelope;
  readonly dispatchEnvelope: ScenarioStartEnvelope;
  service: Principal;
  admin: InitialContextSuite['admin'];
  readonly sessionFor: InitialContextSuite['sessionFor'];
}

export async function verifyRuntimeDispatch(
  scenarioState: VerifyRuntimeDispatchContext,
): Promise<boolean> {
  if (scenarioState.terminalScenario === 'SUCCEEDED') {
    const mutations: readonly (readonly [string, string])[] = [
      ['valid source', ''],
      ['preallocated ID', `NEW.instance_id:='${newUuidV7()}'::uuid;`],
      ['Attempt FK', `NEW.attempt_id:='${newUuidV7()}'::uuid;`],
      ['ack FK', `NEW.ack_observation_id:='${newUuidV7()}'::uuid;`],
      ['Enterprise Scope', `NEW.enterprise_id:='${newUuidV7()}'::uuid;`],
      ['Project Scope', `NEW.project_id:='${newUuidV7()}'::uuid;`],
      ['binding Hash', "NEW.binding_hash:=decode(repeat('0',64),'hex');"],
      ['identity Hash', "NEW.payload_hash:=decode(repeat('0',64),'hex');"],
      [
        'source Receipt',
        `NEW.source_command_id:='${scenarioState.createEnvelope.commandId}'::uuid;`,
      ],
      ['adapter code', "NEW.adapter_code:='te.human_operated.other';"],
      ['adapter version', "NEW.adapter_version:='2.0';"],
      ['ack source', "NEW.source:='CALLER';"],
      ...(['instanceId', 'attemptId', 'ackObservationId', 'bindingHash'] as const).map(
        (field) =>
          [
            `canonical ${field}`,
            `NEW.canonical_payload:=jsonb_set(NEW.canonical_payload,'{${field}}',to_jsonb('${field === 'bindingHash' ? '0'.repeat(64) : newUuidV7()}'::text));
             NEW.payload_hash:=sha256(convert_to(integration_gateway.canonical_jsonb_text(NEW.canonical_payload),'UTF8'));`,
          ] as const,
      ),
    ];
    const outcomes: { label: string; code: string }[] = [];
    for (const [label, statement] of mutations) {
      const probeAttempt = objectRef(
        'integration.runtime_attempt',
        newUuidV7(),
        scenarioState.scope(),
      ) as Common.ObjectRef;
      const storage = new InMemoryRenderObjectStorage();
      const driver = new LocalSyntheticRuntimeDriver(
        undefined,
        storage,
        () => new Date(scenarioState.clock),
      );
      const entry = createControlledFirstRunEntry({
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
        runtimeDriver: driver,
        receiptStorage: storage,
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
      const probeEnvelope = await scenarioState.firstRunEnvelope(
        'integration.request_runtime_dispatch',
        probeAttempt,
        {
          request: {
            ...record(scenarioState.dispatchEnvelope.payload.request),
            stableIdempotencyKey: newUuidV7(),
          },
        },
        scenarioState.service,
      );
      const condition = `NEW.attempt_id='${probeAttempt.objectId}'::uuid`;
      await scenarioState.admin
        .query(`CREATE FUNCTION integration_gateway.wi224_identity_sql_change() RETURNS trigger
            LANGUAGE plpgsql AS $f$ BEGIN ${statement} RETURN NEW; END $f$`);
      await scenarioState.admin
        .query(`CREATE FUNCTION integration_gateway.wi224_identity_sql_end() RETURNS trigger
            LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'WI224_IDENTITY_SQL_ACCEPTED'; END $f$`);
      await scenarioState.admin
        .query(`CREATE TRIGGER aa_wi224_identity_sql BEFORE INSERT ON integration_gateway.runtime_adapter_identity
            FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION integration_gateway.wi224_identity_sql_change()`);
      await scenarioState.admin
        .query(`CREATE TRIGGER zz_wi224_identity_sql AFTER INSERT ON integration_gateway.runtime_adapter_identity
            FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION integration_gateway.wi224_identity_sql_end()`);
      try {
        await entry.dispatch(probeEnvelope, scenarioState.sessionFor(scenarioState.service));
        outcomes.push({ label, code: 'UNEXPECTED_SUCCESS' });
      } catch (error) {
        outcomes.push({
          label,
          code:
            error instanceof Error && error.message.includes('WI224_IDENTITY_SQL_ACCEPTED')
              ? 'ACCEPTED'
              : error !== null && typeof error === 'object' && 'code' in error
                ? String(error.code)
                : 'UNKNOWN',
        });
      } finally {
        await scenarioState.admin.query(
          'DROP TRIGGER aa_wi224_identity_sql ON integration_gateway.runtime_adapter_identity',
        );
        await scenarioState.admin.query(
          'DROP TRIGGER zz_wi224_identity_sql ON integration_gateway.runtime_adapter_identity',
        );
        await scenarioState.admin.query(
          'DROP FUNCTION integration_gateway.wi224_identity_sql_change()',
        );
        await scenarioState.admin.query(
          'DROP FUNCTION integration_gateway.wi224_identity_sql_end()',
        );
      }
      expect(driver.invokedAttemptIds, label).toEqual([probeAttempt.objectId]);
      expect(
        (
          await scenarioState.admin.query<{ status: string }>(
            'SELECT status FROM integration_gateway.runtime_attempt WHERE attempt_id=$1',
            [probeAttempt.objectId],
          )
        ).rows,
        label,
      ).toEqual([{ status: 'CREATED' }]);
      for (const table of [
        'runtime_adapter_identity',
        'runtime_attempt_observation',
        'runtime_final_observation',
      ])
        expect(
          (
            await scenarioState.admin.query<{ count: string }>(
              `SELECT count(*)::text FROM integration_gateway.${table} WHERE attempt_id=$1`,
              [probeAttempt.objectId],
            )
          ).rows,
          `${label} ${table}`,
        ).toEqual([{ count: '0' }]);
      expect(
        (
          await scenarioState.admin.query<{ count: string }>(
            'SELECT count(*)::text FROM integration_gateway.raw_external_receipt WHERE runtime_attempt_id=$1',
            [probeAttempt.objectId],
          )
        ).rows,
        `${label} raw receipt rollback`,
      ).toEqual([{ count: '0' }]);
      if (label === 'valid source') {
        const originalAck = await driver.readBack(probeAttempt);
        if (originalAck === undefined) throw new Error('missing original rolled-back ack');
        const recovered = await Promise.all([
          entry.dispatch(probeEnvelope, scenarioState.sessionFor(scenarioState.service)),
          entry.dispatch(probeEnvelope, scenarioState.sessionFor(scenarioState.service)),
        ]);
        expect(recovered[0]).toMatchObject({ status: 'SUCCEEDED' });
        expect(recovered[1]).toEqual(recovered[0]);
        expect(driver.invokedAttemptIds).toEqual([probeAttempt.objectId]);
        expect(
          (
            await scenarioState.admin.query<{ instance_id: string }>(
              'SELECT instance_id FROM integration_gateway.runtime_adapter_identity WHERE attempt_id=$1',
              [probeAttempt.objectId],
            )
          ).rows,
        ).toEqual([{ instance_id: originalAck.runtimeAdapterIdentityRef.objectId }]);
        for (const table of ['runtime_attempt_observation', 'raw_external_receipt']) {
          const field = table === 'raw_external_receipt' ? 'runtime_attempt_id' : 'attempt_id';
          expect(
            (
              await scenarioState.admin.query<{ count: string }>(
                `SELECT count(*)::text FROM integration_gateway.${table} WHERE ${field}=$1`,
                [probeAttempt.objectId],
              )
            ).rows,
          ).toEqual([{ count: '1' }]);
        }
        expect(
          (
            await scenarioState.admin.query<{ count: string }>(
              "SELECT count(*)::text FROM integration_gateway.outbox_event WHERE aggregate_id=$1 AND event_type='integration.RuntimeDispatchSucceeded'",
              [probeAttempt.objectId],
            )
          ).rows,
        ).toEqual([{ count: '1' }]);
      }
    }
    expect(outcomes[0]).toEqual({ label: 'valid source', code: 'ACCEPTED' });
    for (const outcome of outcomes.slice(1))
      expect
        .soft(['22023', '23514', '23503', '42501'], `${outcome.label}: ${outcome.code}`)
        .toContain(outcome.code);
  }
  return false;
}
