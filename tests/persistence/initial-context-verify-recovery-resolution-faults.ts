import type { createBlockedInputRecoveryEntry } from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import {
  createRecoveryAuthorizationPort,
  readRecoveryHumanEligibility,
  type RecoveryHumanEligibilityInput,
} from '@zhiju/identity-policy';
import type { CanonicalJsonValue } from '@zhiju/shared-kernel';
import { type CanonicalJsonObject, newUuidV7 } from '@zhiju/shared-kernel';
import { digestCanonicalPayload } from '@zhiju/task-execution';
import type { KyselyPlugin } from 'kysely';
import { expect } from 'vitest';
import {
  AUTH_HASH,
  contentHash,
  definedValue,
  objectRef,
  OPERATOR,
  type Principal,
  record,
} from './initial-context-fixtures.js';
import type {
  ScenarioRecoveryConfig,
  ScenarioRecoveryEnvelope,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifyRecoveryResolutionFaultsContext {
  readonly exerciseRecoveryFaultMatrix: boolean;
  admin: InitialContextSuite['admin'];
  readonly resolutionRef: unknown;
  readonly recoveryCodes: Record<string, string>;
  readonly scope: InitialContextSuite['scope'];
  readonly identityDeps: InitialContextSuite['identityDeps'];
  fixture: InitialContextSuite['fixture'];
  service: Principal;
  readonly recoveryConfig: ScenarioRecoveryConfig;
  historicalProof:
    | {
        input: RecoveryHumanEligibilityInput;
        authority: Parameters<typeof readRecoveryHumanEligibility>[2];
      }
    | undefined;
  identityDb: InitialContextSuite['identityDb'];
  readonly serviceId: string;
  readonly revokeCapabilityTracked: InitialContextSuite['revokeCapabilityTracked'];
  clock: InitialContextSuite['clock'];
  readonly grant: InitialContextSuite['grant'];
  readonly confirmationIssuedAt: CanonicalJsonValue | undefined;
  recoveryProposeEnvelope: Record<string, unknown> | undefined;
  readonly recoveryEnvelope: ScenarioRecoveryEnvelope;
  readonly requestRef: Common.ObjectRef;
  readonly resolvePayload: CanonicalJsonObject;
  readonly operator: InitialContextSuite['operator'];
  readonly recoveryEntry: ReturnType<typeof createBlockedInputRecoveryEntry>;
  readonly sessionFor: InitialContextSuite['sessionFor'];
}

export async function verifyRecoveryResolutionFaults(
  scenarioState: VerifyRecoveryResolutionFaultsContext,
): Promise<boolean> {
  if (scenarioState.exerciseRecoveryFaultMatrix) {
    const confirmationIssuedAt = scenarioState.confirmationIssuedAt;
    if (typeof confirmationIssuedAt !== 'string') throw new Error('missing confirmation timestamp');
    // Historical integrity uses the actual committed time, independently of current expiry.
    const attestation = record(
      definedValue(
        (
          await scenarioState.admin.query<{ canonical_payload: Record<string, unknown> }>(
            'SELECT canonical_payload FROM task_execution.resolution_receipt_observation WHERE resolution_id=$1',
            [record(scenarioState.resolutionRef).objectId],
          )
        ).rows[0],
      ).canonical_payload,
    );
    const confirmationDecisionExpiry = (
      await scenarioState.admin.query<{ expires_at: Date }>(
        'SELECT expires_at FROM identity_policy.authorization_decision WHERE authorization_decision_id=$1',
        [record(attestation.authorizationDecisionRef).objectId],
      )
    ).rows[0]?.expires_at;
    const historyNow = new Date(definedValue(confirmationDecisionExpiry).getTime() + 1);
    const historicalAuth = createRecoveryAuthorizationPort({
      capabilityCodes: scenarioState.recoveryCodes,
      now: () => historyNow,
    });
    const eligibilityInput = {
      principalRef: { principalKind: 'HUMAN', principalId: OPERATOR },
      scopeRef: scenarioState.scope(),
      roleCode: 'project.customer_material.confirmer',
      confirmationActorSnapshotRef: attestation.actorSnapshotRef,
      confirmationAuthorizationDecisionRef: attestation.authorizationDecisionRef,
      confirmationTargetRef: attestation.targetRef,
      confirmationRequestPayloadHash: attestation.requestPayloadHash,
      confirmationCommittedAt: attestation.committedAt,
    } as unknown as RecoveryHumanEligibilityInput;
    const historyTarget = objectRef(
      'zhiju.identity.principal',
      OPERATOR,
      scenarioState.scope(),
    ) as Common.ObjectRef;
    const historicalDecision = await historicalAuth.authorize(
      scenarioState.identityDeps([scenarioState.fixture.projectId], scenarioState.service),
      'recovery.request_resolve.human.v1',
      {
        actorSnapshotRef: scenarioState.service.actorRef,
        commandType: 'execution.recovery.request_resolve.human',
        commandVersion: '1.0',
        commandPayloadHash: digestCanonicalPayload(
          eligibilityInput as unknown as CanonicalJsonObject,
        ).hash,
        authenticationContextHash: AUTH_HASH,
        targetRef: historyTarget,
      },
    );
    if (historicalDecision.outcome !== 'ALLOW') throw new Error('Historical proof read denied');
    const historyProof = async () => {
      const view = await historicalAuth.revalidate(
        scenarioState.identityDeps([scenarioState.fixture.projectId], scenarioState.service),
        'recovery.request_resolve.human.v1',
        {
          decisionRef: historicalDecision.authorizationDecisionRef,
          expectedCommandType: 'execution.recovery.request_resolve.human',
          expectedCommandVersion: '1.0',
          expectedCommandPayloadHash: digestCanonicalPayload(
            eligibilityInput as unknown as CanonicalJsonObject,
          ).hash,
          expectedAuthenticationContextHash: AUTH_HASH,
          expectedTargetRef: historyTarget,
        },
      );
      expect(view.valid).toBe(true);
    };
    const historyAuthority = {
      now: () => historyNow,
      validUntil: () => new Date(historicalDecision.expiresAt),
      revalidateAuthorization: historyProof,
      requiredCapabilities: [
        {
          capabilityCode: scenarioState.recoveryConfig.humanCapabilityCodes.answerSubmit,
          action: 'execution.information_request.answer.submit.v1',
          targetObjectType: 'execution.information_request',
        },
        {
          capabilityCode: scenarioState.recoveryConfig.humanCapabilityCodes.requestResolve,
          action: 'execution.information_request.resolve.v1',
          targetObjectType: 'execution.information_request',
        },
        {
          capabilityCode: scenarioState.recoveryConfig.humanCapabilityCodes.materialRead,
          action: 'project.customer_material.recovery_refs.read.for_answer_submit.v1',
          targetObjectType: 'zhiju.project.customer_material',
        },
      ],
    };
    scenarioState.historicalProof = { input: eligibilityInput, authority: historyAuthority };
    expect(
      await readRecoveryHumanEligibility(
        scenarioState.identityDeps([scenarioState.fixture.projectId], scenarioState.service),
        eligibilityInput,
        historyAuthority,
      ),
    ).toMatchObject({ confirmationProvenanceValid: true });
    // Simulate a database insertion clock ahead of the application clock.
    // The actual owning Decision, canonical hash, Actor and Receipt stay
    // intact; technical created_at must not replace its signed issuance.
    const databaseClockAhead: KyselyPlugin = {
      transformQuery: (args) => args.node,
      transformResult: (args) =>
        Promise.resolve({
          ...args.result,
          rows: args.result.rows.map((row) =>
            row.authorization_decision_id === record(attestation.authorizationDecisionRef).objectId
              ? { ...row, created_at: new Date(historyNow.getTime() + 1_000) }
              : row,
          ),
        }),
    };
    expect(
      await readRecoveryHumanEligibility(
        {
          ...scenarioState.identityDeps([scenarioState.fixture.projectId], scenarioState.service),
          db: scenarioState.identityDb.withPlugin(databaseClockAhead),
        },
        eligibilityInput,
        historyAuthority,
      ),
    ).toMatchObject({ confirmationProvenanceValid: true });
    // Real owning Grants isolate same-code action/selector coverage without
    // replacing the repository, Policy integrity or historical proof.
    const sharedCode = `wi231.r2.${scenarioState.serviceId.replaceAll('-', '')}`;
    const answerBinding = {
      capabilityCode: sharedCode,
      action: 'execution.information_request.answer.submit.v1',
      targetObjectType: 'execution.information_request',
    };
    const resolveBinding = {
      capabilityCode: sharedCode,
      action: 'execution.information_request.resolve.v1',
      targetObjectType: 'execution.information_request',
    };
    const probeAuthority = {
      ...historyAuthority,
      requiredCapabilities: [answerBinding, resolveBinding],
    };
    const readProbe = (requiredCapabilities = probeAuthority.requiredCapabilities) =>
      readRecoveryHumanEligibility(
        scenarioState.identityDeps([scenarioState.fixture.projectId], scenarioState.service),
        eligibilityInput,
        { ...probeAuthority, requiredCapabilities },
      );
    const revokeProbe = async (targetId: string) => {
      expect(
        await scenarioState.revokeCapabilityTracked(
          scenarioState.identityDeps([scenarioState.fixture.projectId]),
          {
            targetId,
            expectedAggregateVersion: '1',
            scope: {
              scopeKind: 'PROJECT',
              enterpriseId: scenarioState.fixture.enterpriseId,
              projectId: scenarioState.fixture.projectId,
            },
            reasonCode: 'WI232_R2_REVOKE_PROBE',
            effectiveAt: new Date(scenarioState.clock),
            idempotencyKey: newUuidV7(),
          },
        ),
      ).toMatchObject({ status: 'COMMITTED' });
    };
    const answerOnly = () => scenarioState.grant({ ...answerBinding, selectorType: 'TARGET_TYPE' });
    const answerGrant = await answerOnly();
    await expect(readProbe(), 'same code cannot supply a missing action').rejects.toMatchObject({
      code: 'AUTHORIZATION_DECISION_INVALID',
    });
    await revokeProbe(answerGrant);
    const combinedGrant = await scenarioState.grant({
      ...answerBinding,
      actions: [answerBinding.action, resolveBinding.action],
      selectorType: 'TARGET_TYPE',
    });
    const usable = await readProbe();
    expect(usable).toMatchObject({
      useStatus: 'USABLE',
      confirmationProvenanceValid: true,
    });
    expect(usable.grantRefs.map((ref) => ref.objectId)).toEqual([combinedGrant]);
    await expect(
      readProbe([
        answerBinding,
        { ...resolveBinding, targetObjectType: 'zhiju.execution.work_order' },
      ]),
      'same code cannot cover a different target',
    ).rejects.toMatchObject({
      code: 'AUTHORIZATION_DECISION_INVALID',
    });
    await revokeProbe(combinedGrant);
    const remainingAnswer = await answerOnly();
    expect(await readProbe([answerBinding])).toMatchObject({ useStatus: 'USABLE' });
    await expect(readProbe(), 'same code cannot mask removed resolve rights').rejects.toMatchObject(
      {
        code: 'AUTHORIZATION_DECISION_INVALID',
      },
    );
    await revokeProbe(remainingAnswer);
    await scenarioState.grant({
      ...answerBinding,
      actions: [answerBinding.action, resolveBinding.action],
      selectorType: 'CREATE_TARGET_TYPE',
    });
    await expect(readProbe(), 'CREATE selector does not cover TARGET_TYPE').rejects.toMatchObject({
      code: 'AUTHORIZATION_DECISION_INVALID',
    });
    for (const change of [
      {
        confirmationTargetRef: { ...record(attestation.targetRef), objectId: newUuidV7() },
      },
      { confirmationRequestPayloadHash: contentHash('0'.repeat(64)) },
      {
        confirmationActorSnapshotRef: {
          ...record(attestation.actorSnapshotRef),
          objectId: newUuidV7(),
        },
      },
      {
        confirmationAuthorizationDecisionRef: {
          ...record(attestation.authorizationDecisionRef),
          objectId: newUuidV7(),
        },
      },
      { confirmationCommittedAt: new Date(historyNow.getTime() + 1).toISOString() },
      {
        confirmationCommittedAt: new Date(Date.parse(confirmationIssuedAt) - 1).toISOString(),
      },
      // An actual propose Decision has intact hashes, actor, Scope and target, but the wrong operation/Purpose.
      {
        confirmationAuthorizationDecisionRef: definedValue(scenarioState.recoveryProposeEnvelope)
          .authorizationDecisionRef,
        confirmationTargetRef: definedValue(scenarioState.recoveryProposeEnvelope).targetRef,
        confirmationRequestPayloadHash: record(
          definedValue(scenarioState.recoveryProposeEnvelope).integrity,
        ).payloadHash,
      },
    ]) {
      const changed = { ...eligibilityInput, ...change } as RecoveryHumanEligibilityInput;
      const payloadHash = digestCanonicalPayload(changed as unknown as CanonicalJsonObject).hash;
      const proof = await historicalAuth.authorize(
        scenarioState.identityDeps([scenarioState.fixture.projectId], scenarioState.service),
        'recovery.request_resolve.human.v1',
        {
          actorSnapshotRef: scenarioState.service.actorRef,
          commandType: 'execution.recovery.request_resolve.human',
          commandVersion: '1.0',
          commandPayloadHash: payloadHash,
          authenticationContextHash: AUTH_HASH,
          targetRef: historyTarget,
        },
      );
      if (proof.outcome !== 'ALLOW') throw new Error('history consumer proof denied');
      await expect(
        readRecoveryHumanEligibility(
          scenarioState.identityDeps([scenarioState.fixture.projectId], scenarioState.service),
          changed,
          {
            ...historyAuthority,
            validUntil: () => new Date(proof.expiresAt),
            revalidateAuthorization: async () => {
              expect(
                await historicalAuth.revalidate(
                  scenarioState.identityDeps(
                    [scenarioState.fixture.projectId],
                    scenarioState.service,
                  ),
                  'recovery.request_resolve.human.v1',
                  {
                    decisionRef: proof.authorizationDecisionRef,
                    expectedCommandType: 'execution.recovery.request_resolve.human',
                    expectedCommandVersion: '1.0',
                    expectedCommandPayloadHash: payloadHash,
                    expectedAuthenticationContextHash: AUTH_HASH,
                    expectedTargetRef: historyTarget,
                  },
                ),
              ).toMatchObject({ valid: true });
            },
          },
        ),
      ).rejects.toBeDefined();
    }
    // Different-key replay keeps original effectiveAt and Event/version.
    const resolveAgain = await scenarioState.recoveryEnvelope(
      'informationRequestResolveV1',
      scenarioState.requestRef,
      scenarioState.resolvePayload,
      scenarioState.operator(),
      3,
    );
    expect(
      await scenarioState.recoveryEntry.command(resolveAgain, scenarioState.sessionFor()),
    ).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { resolutionRef: scenarioState.resolutionRef },
    });
  }
  return false;
}
