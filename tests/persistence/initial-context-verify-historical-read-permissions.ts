import type { createControlledFirstRunEntry } from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import { CONTROLLED_FIRST_RUN_BINDINGS } from '@zhiju/identity-policy';
import { newUuidV7 } from '@zhiju/shared-kernel';
import { scanControlledFinalCandidates, type TaskExecutionDb } from '@zhiju/task-execution';
import type { Kysely } from 'kysely';
import { expect } from 'vitest';
import type { Principal } from './initial-context-fixtures.js';
import type {
  ScenarioFinalQuery,
  ScenarioFirstRunCodes,
  ScenarioScanContext,
  ScenarioStartEnvelope,
  ScenarioTerminalScenario,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifyHistoricalReadPermissionsContext {
  readonly terminalScenario: ScenarioTerminalScenario;
  readonly firstRunEntry: ReturnType<typeof createControlledFirstRunEntry>;
  readonly startEnvelope: ScenarioStartEnvelope;
  readonly startSession: {
    serviceEntryAt: Date;
    authenticationContextHash: Buffer;
    resolutionActorSnapshotRef: Common.SnapshotRef;
  };
  readonly recordEnvelope: ScenarioStartEnvelope;
  readonly sessionFor: InitialContextSuite['sessionFor'];
  service: Principal;
  readonly validateEnvelope: ScenarioStartEnvelope;
  acceptEnvelope: ScenarioStartEnvelope;
  readonly finalizeEnvelope: ScenarioStartEnvelope;
  readonly resultQuery: ScenarioFinalQuery;
  readonly terminalRunQuery: ScenarioFinalQuery;
  readonly finalQuery: ScenarioFinalQuery;
  readonly firstRunGrants: Map<string, string>;
  readonly revokeCapabilityTracked: InitialContextSuite['revokeCapabilityTracked'];
  readonly identityDeps: InitialContextSuite['identityDeps'];
  fixture: InitialContextSuite['fixture'];
  clock: InitialContextSuite['clock'];
  readonly queryReads: string[];
  readonly protectedReads: () => string[];
  readonly grant: InitialContextSuite['grant'];
  readonly firstRunCodes: ScenarioFirstRunCodes;
  readonly queueEnvelope: ScenarioStartEnvelope;
  readonly guardedTeDb: Kysely<TaskExecutionDb>;
  readonly scanContext: ScenarioScanContext;
  readonly scanProof: () => Promise<void>;
}

export async function verifyHistoricalReadPermissions(
  scenarioState: VerifyHistoricalReadPermissionsContext,
): Promise<boolean> {
  if (scenarioState.terminalScenario === 'SUCCEEDED') {
    for (const [boundary, replay] of [
      [
        'runStartV1',
        () =>
          scenarioState.firstRunEntry.startRun(
            scenarioState.startEnvelope,
            scenarioState.startSession,
          ),
      ],
      [
        'runResultRecordV1',
        () =>
          scenarioState.firstRunEntry.recordRunResult(
            scenarioState.recordEnvelope,
            scenarioState.sessionFor(scenarioState.service),
          ),
      ],
      [
        'agentResultValidateV1',
        () =>
          scenarioState.firstRunEntry.validateAgentResult(
            scenarioState.validateEnvelope,
            scenarioState.sessionFor(scenarioState.service),
          ),
      ],
      [
        'agentResultAcceptV1',
        () =>
          scenarioState.firstRunEntry.acceptAgentResult(
            scenarioState.acceptEnvelope,
            scenarioState.sessionFor(scenarioState.service),
          ),
      ],
      [
        'runFinalizeV1',
        () =>
          scenarioState.firstRunEntry.finalizeRun(
            scenarioState.finalizeEnvelope,
            scenarioState.sessionFor(scenarioState.service),
          ),
      ],
      [
        'agentResultReadV1',
        () =>
          scenarioState.firstRunEntry.getAgentResult(
            scenarioState.resultQuery,
            scenarioState.sessionFor(scenarioState.service),
          ),
      ],
      [
        'runStateReadV1',
        () =>
          scenarioState.firstRunEntry.getRunState(
            scenarioState.terminalRunQuery,
            scenarioState.sessionFor(scenarioState.service),
          ),
      ],
      [
        'runtimeFinalReadV1',
        () =>
          scenarioState.firstRunEntry.getRuntimeFinalObservation(
            scenarioState.finalQuery,
            scenarioState.sessionFor(scenarioState.service),
          ),
      ],
    ] as const) {
      const grantId = scenarioState.firstRunGrants.get(boundary);
      const binding = CONTROLLED_FIRST_RUN_BINDINGS.find(
        (candidate) => candidate.boundary === boundary,
      );
      const targetObjectType = binding?.targetObjectTypes[0];
      if (grantId === undefined || binding === undefined || targetObjectType === undefined)
        throw new Error(`missing independent ${boundary} Grant`);
      expect(
        await scenarioState.revokeCapabilityTracked(
          scenarioState.identityDeps([scenarioState.fixture.projectId]),
          {
            targetId: grantId,
            expectedAggregateVersion: '1',
            scope: {
              scopeKind: 'PROJECT',
              enterpriseId: scenarioState.fixture.enterpriseId,
              projectId: scenarioState.fixture.projectId,
            },
            reasonCode: 'WI224_REVOKE_FINAL_BOUNDARY',
            effectiveAt: new Date(scenarioState.clock),
            idempotencyKey: newUuidV7(),
          },
        ),
      ).toMatchObject({ status: 'COMMITTED' });
      scenarioState.queryReads.length = 0;
      await expect(replay()).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
      expect(scenarioState.protectedReads(), boundary).toEqual([]);
      await scenarioState.grant({
        principal: scenarioState.service,
        capabilityCode: scenarioState.firstRunCodes[boundary],
        action: binding.requiredGrantAction,
        selectorType: binding.selectorType,
        targetObjectType,
      });
    }
    const queueGrantId = scenarioState.firstRunGrants.get('workOrderQueueV1');
    if (queueGrantId === undefined) throw new Error('missing Queue Grant');
    expect(
      await scenarioState.revokeCapabilityTracked(
        scenarioState.identityDeps([scenarioState.fixture.projectId]),
        {
          targetId: queueGrantId,
          expectedAggregateVersion: '1',
          scope: {
            scopeKind: 'PROJECT',
            enterpriseId: scenarioState.fixture.enterpriseId,
            projectId: scenarioState.fixture.projectId,
          },
          reasonCode: 'WI221_REVOKE_QUEUE',
          effectiveAt: new Date(scenarioState.clock),
          idempotencyKey: newUuidV7(),
        },
      ),
    ).toMatchObject({ status: 'COMMITTED' });
    await expect(
      scenarioState.firstRunEntry.queue(scenarioState.queueEnvelope, scenarioState.sessionFor()),
    ).rejects.toMatchObject({
      code: 'AUTHORIZATION_REVOKED',
    });
    const scanGrantId = scenarioState.firstRunGrants.get('runFinalCandidateScanV1');
    if (scanGrantId === undefined) throw new Error('missing final scan Grant');
    expect(
      await scenarioState.revokeCapabilityTracked(
        scenarioState.identityDeps([scenarioState.fixture.projectId]),
        {
          targetId: scanGrantId,
          expectedAggregateVersion: '1',
          scope: {
            scopeKind: 'PROJECT',
            enterpriseId: scenarioState.fixture.enterpriseId,
            projectId: scenarioState.fixture.projectId,
          },
          reasonCode: 'WI224_REVOKE_FINAL_SCAN',
          effectiveAt: new Date(scenarioState.clock),
          idempotencyKey: newUuidV7(),
        },
      ),
    ).toMatchObject({ status: 'COMMITTED' });
    scenarioState.queryReads.length = 0;
    await expect(
      scanControlledFinalCandidates(
        scenarioState.guardedTeDb,
        scenarioState.scanContext,
        () => new Date(scenarioState.clock),
        scenarioState.scanProof,
      ),
    ).rejects.toBeDefined();
    expect(scenarioState.protectedReads(), 'scan Grant revoked').toEqual([]);
  }
  return false;
}
