import { createControlledFirstRunEntry, type InitialContextSession } from '@zhiju/api/composition';
import type { createControlledFirstRunAuthorizationPort } from '@zhiju/identity-policy';
import { CONTROLLED_FIRST_RUN_BINDINGS } from '@zhiju/identity-policy';
import type {
  InMemoryRenderObjectStorage,
  LocalSyntheticRuntimeDriver,
} from '@zhiju/integration-gateway';
import { createIntegrationRendererDatabase } from '@zhiju/integration-gateway';
import { newUuidV7 } from '@zhiju/shared-kernel';
import { digestCanonicalPayload } from '@zhiju/task-execution';
import type { KyselyPlugin } from 'kysely';
import { expect } from 'vitest';
import { contentHash, dependencyCapabilities, type Principal } from './initial-context-fixtures.js';
import type {
  ScenarioFirstRunCodes,
  ScenarioFirstRunEnvelope,
  ScenarioRecoveryConfig,
  ScenarioStartEnvelope,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifyFinalDependenciesContext {
  readonly firstRunEnvelope: ScenarioFirstRunEnvelope;
  readonly exercisePreparationMatrix: boolean;
  teDb: InitialContextSuite['teDb'];
  enterpriseProjectDb: InitialContextSuite['enterpriseProjectDb'];
  identityDb: InitialContextSuite['identityDb'];
  identityRepo: InitialContextSuite['identityRepo'];
  readonly crypto: InitialContextSuite['crypto'];
  tePool: InitialContextSuite['tePool'];
  readonly runtimeDriver: LocalSyntheticRuntimeDriver;
  readonly runtimeJournal: InMemoryRenderObjectStorage;
  readonly firstRunCodes: ScenarioFirstRunCodes;
  readonly bounded: boolean;
  readonly recoveryCodes: Record<string, string>;
  readonly recoveryConfig: ScenarioRecoveryConfig;
  clock: InitialContextSuite['clock'];
  readonly borrowedActors: Principal[];
  readonly sessionFor: InitialContextSuite['sessionFor'];
  readonly receiptRows: InitialContextSuite['receiptRows'];
  readonly startEnvelope: ScenarioStartEnvelope;
  service: Principal;
  readonly operator: InitialContextSuite['operator'];
  fixture: InitialContextSuite['fixture'];
  readonly firstRunGrants: Map<string, string>;
  readonly firstRunAuth: ReturnType<typeof createControlledFirstRunAuthorizationPort>;
  readonly identityDeps: InitialContextSuite['identityDeps'];
  readonly revokeCapabilityTracked: InitialContextSuite['revokeCapabilityTracked'];
  readonly grant: InitialContextSuite['grant'];
}

export async function verifyFinalDependencies(
  scenarioState: VerifyFinalDependenciesContext,
  envelope: Awaited<ReturnType<typeof scenarioState.firstRunEnvelope>>,
  execute: (
    entry: ReturnType<typeof createControlledFirstRunEntry>,
    value: unknown,
    session: InitialContextSession,
  ) => Promise<unknown>,
): Promise<void> {
  if (!scenarioState.exercisePreparationMatrix) return;
  const reads: string[] = [];
  const probePlugin: KyselyPlugin = {
    transformQuery(args) {
      if (args.node.kind === 'SelectQueryNode') reads.push(JSON.stringify(args.node));
      return args.node;
    },
    transformResult: (args) => Promise.resolve(args.result),
  };
  const probeEntry = createControlledFirstRunEntry({
    taskExecutionDb: scenarioState.teDb.withPlugin(probePlugin),
    enterpriseProjectDb: scenarioState.enterpriseProjectDb,
    identity: {
      db: scenarioState.identityDb.withPlugin(probePlugin),
      repo: scenarioState.identityRepo,
      crypto: scenarioState.crypto,
    },
    integrationGatewayDb: createIntegrationRendererDatabase(scenarioState.tePool).withPlugin(
      probePlugin,
    ),
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
  // Actor, scope, authentication and unrelated current Decisions fail
  // before any protected TE or IG repository read.
  for (const borrower of scenarioState.borrowedActors) {
    reads.length = 0;
    await expect(
      execute(
        probeEntry,
        { ...envelope, actor: borrower.actorRef },
        scenarioState.sessionFor(borrower),
      ),
    ).rejects.toBeDefined();
    expect(
      reads.filter((query) => /"name":"(?:task_execution|integration_gateway)"/u.test(query)),
    ).toEqual([]);
    expect(await scenarioState.receiptRows(envelope.idempotencyKey)).toEqual([]);
  }
  for (const [label, value, session] of [
    [
      'other operation Decision',
      {
        ...envelope,
        authorizationDecisionRef: scenarioState.startEnvelope.authorizationDecisionRef,
      },
      scenarioState.sessionFor(scenarioState.service),
    ],
    [
      'other principal Actor',
      { ...envelope, actor: scenarioState.operator().actorRef },
      scenarioState.sessionFor(),
    ],
    [
      'Actor Snapshot Hash',
      {
        ...envelope,
        actor: { ...scenarioState.service.actorRef, contentHash: contentHash('0'.repeat(64)) },
      },
      scenarioState.sessionFor(scenarioState.service),
    ],
    ['session Actor', envelope, scenarioState.sessionFor()],
    [
      'authentication Hash',
      envelope,
      {
        ...scenarioState.sessionFor(scenarioState.service),
        authenticationContextHash: Buffer.alloc(32),
      },
    ],
    [
      'target ID',
      { ...envelope, targetRef: { ...envelope.targetRef, objectId: newUuidV7() } },
      scenarioState.sessionFor(scenarioState.service),
    ],
    [
      'Project Scope',
      {
        ...envelope,
        scopeRef: { enterpriseId: scenarioState.fixture.enterpriseId, projectId: newUuidV7() },
      },
      scenarioState.sessionFor(scenarioState.service),
    ],
    [
      'Enterprise Scope',
      {
        ...envelope,
        scopeRef: { enterpriseId: newUuidV7(), projectId: scenarioState.fixture.projectId },
      },
      scenarioState.sessionFor(scenarioState.service),
    ],
  ] as const) {
    scenarioState.clock = Math.max(scenarioState.clock, Date.now());
    reads.length = 0;
    await expect(execute(probeEntry, value, session), label).rejects.toBeDefined();
    expect(
      reads.filter((query) => /"name":"(?:task_execution|integration_gateway)"/u.test(query)),
      label,
    ).toEqual([]);
    expect(await scenarioState.receiptRows(envelope.idempotencyKey), label).toEqual([]);
  }
  for (const binding of CONTROLLED_FIRST_RUN_BINDINGS.filter(
    (candidate) =>
      candidate.commandType === envelope.commandType &&
      /(?:Binding|Final|Bundle|Policy|Source)ReadV1$/u.test(candidate.boundary),
  )) {
    const grantId = scenarioState.firstRunGrants.get(binding.boundary);
    const targetObjectType = binding.targetObjectTypes[0];
    if (grantId === undefined || targetObjectType === undefined)
      throw new Error(`missing ${binding.boundary} dependency Grant`);
    const table = binding.boundary.endsWith('BindingReadV1')
      ? 'runtime_attempt'
      : binding.boundary.endsWith('FinalReadV1')
        ? 'runtime_final_observation'
        : binding.boundary.endsWith('BundleReadV1')
          ? 'execution_capability_bundle'
          : binding.boundary.endsWith('PolicyReadV1')
            ? 'policy_version'
            : binding.boundary === 'runFinalizeSourceReadV1'
              ? 'agent_result_acceptance'
              : 'agent_result';
    const ownBoundary = CONTROLLED_FIRST_RUN_BINDINGS.find(
      (candidate) =>
        candidate.commandType === envelope.commandType &&
        candidate.targetObjectTypes.includes(envelope.targetRef.objectType) &&
        [
          'agentResultSubmitV1',
          'runResultRecordV1',
          'agentResultValidateV1',
          'agentResultAcceptV1',
          'runFinalizeV1',
        ].includes(candidate.boundary),
    )?.boundary;
    if (ownBoundary === undefined) throw new Error('missing own final boundary');
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
          reasonCode: 'WI224_REVOKE_FINAL_DEPENDENCY',
          effectiveAt: new Date(scenarioState.clock),
          idempotencyKey: newUuidV7(),
        },
      ),
    ).toMatchObject({ status: 'COMMITTED' });
    scenarioState.clock = Math.max(scenarioState.clock, Date.now());
    reads.length = 0;
    await expect(
      execute(probeEntry, envelope, scenarioState.sessionFor(scenarioState.service)),
      binding.boundary,
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
    expect(
      reads.filter((query) => query.includes(`"kind":"IdentifierNode","name":"${table}"`)),
      binding.boundary,
    ).toEqual([]);
    expect(await scenarioState.receiptRows(envelope.idempotencyKey), binding.boundary).toEqual([]);
    scenarioState.firstRunGrants.set(
      binding.boundary,
      await scenarioState.grant({
        principal: scenarioState.service,
        capabilityCode: scenarioState.firstRunCodes[binding.boundary],
        action: binding.requiredGrantAction,
        selectorType: binding.selectorType,
        targetObjectType,
      }),
    );
  }
}
