import type {
  createBlockedInputRecoveryEntry,
  createControlledFirstRunEntry,
} from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import {
  readRecoveryHumanEligibility,
  type RecoveryHumanEligibilityInput,
} from '@zhiju/identity-policy';
import { type CanonicalJsonObject, newUuidV7 } from '@zhiju/shared-kernel';
import { expect } from 'vitest';
import { definedValue, objectRef, OPERATOR, type Principal } from './initial-context-fixtures.js';
import type {
  ScenarioFirstRunEnvelope,
  ScenarioRecoveryConfig,
  ScenarioRecoveryEnvelope,
  ScenarioStartEnvelope,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifySecondRunCreationFaultsContext {
  readonly exerciseRecoveryFaultMatrix: boolean;
  readonly recoveryConfig: ScenarioRecoveryConfig;
  readonly denialSnapshot: () => Promise<
    {
      status: string;
      aggregate_version: string;
      accepted_answer_ref: unknown;
      resolution_ref: unknown;
    }[]
  >;
  readonly revokeCapabilityTracked: InitialContextSuite['revokeCapabilityTracked'];
  readonly identityDeps: InitialContextSuite['identityDeps'];
  fixture: InitialContextSuite['fixture'];
  readonly recoveryGrants: Map<string, string>;
  clock: InitialContextSuite['clock'];
  readonly grant: InitialContextSuite['grant'];
  service: Principal;
  historicalProof:
    | {
        input: RecoveryHumanEligibilityInput;
        authority: Parameters<typeof readRecoveryHumanEligibility>[2];
      }
    | undefined;
  readonly scope: InitialContextSuite['scope'];
  readonly recoveryEnvelope: ScenarioRecoveryEnvelope;
  readonly buildRequest: {
    expiresAt?: string;
    workOrderRef: Common.ObjectRef;
    workOrderContractRef: {
      kind: string;
      objectType: string;
      objectId: string;
      scope: { enterpriseId: string; projectId: string };
      contentHash: CanonicalJsonObject;
    };
    projectionType: unknown;
    purpose: unknown;
    audience: { kind: string; objectType: string; objectId: string; scope: Record<string, string> };
    sourceSlices: Common.ContentAddressedRef[];
    answeredInformationRefs: unknown[];
    builderPolicyRef: unknown;
  };
  readonly recoveryEntryRaw: ReturnType<typeof createBlockedInputRecoveryEntry>;
  readonly sessionFor: InitialContextSuite['sessionFor'];
  readonly contextSnapshotRow: InitialContextSuite['contextSnapshotRow'];
  readonly receiptRows: InitialContextSuite['receiptRows'];
  readonly firstRunEnvelope: ScenarioFirstRunEnvelope;
  readonly bundle2Envelope: ScenarioStartEnvelope;
  readonly firstRunEntryRaw: ReturnType<typeof createControlledFirstRunEntry>;
  admin: InitialContextSuite['admin'];
  readonly create2: ScenarioStartEnvelope;
  readonly run2: Common.ObjectRef;
}

export async function verifySecondRunCreationFaults(
  scenarioState: VerifySecondRunCreationFaultsContext,
): Promise<boolean> {
  if (scenarioState.exerciseRecoveryFaultMatrix) {
    // A saved Resolution/Context/Bundle must not hide current Human
    // resolve revocation behind an answer Grant with the same code.
    expect(scenarioState.recoveryConfig.humanCapabilityCodes.requestResolve).toBe(
      scenarioState.recoveryConfig.humanCapabilityCodes.answerSubmit,
    );
    const grantKey = `${OPERATOR}:informationRequestResolveV1:execution.information_request`;
    const resolvedBeforeRevoke = await scenarioState.denialSnapshot();
    expect(
      await scenarioState.revokeCapabilityTracked(
        scenarioState.identityDeps([scenarioState.fixture.projectId]),
        {
          targetId: definedValue(scenarioState.recoveryGrants.get(grantKey)),
          expectedAggregateVersion: '1',
          scope: {
            scopeKind: 'PROJECT',
            enterpriseId: scenarioState.fixture.enterpriseId,
            projectId: scenarioState.fixture.projectId,
          },
          reasonCode: 'WI232_R2_REVOKE_CURRENT_RESOLVE',
          effectiveAt: new Date(scenarioState.clock),
          idempotencyKey: newUuidV7(),
        },
      ),
    ).toMatchObject({ status: 'COMMITTED' });
    const remainingAnswerGrant = await scenarioState.grant({
      capabilityCode: scenarioState.recoveryConfig.humanCapabilityCodes.answerSubmit,
      action: 'execution.information_request.answer.submit.v1',
      selectorType: 'TARGET_TYPE',
      targetObjectType: 'execution.information_request',
    });
    expect(
      await readRecoveryHumanEligibility(
        scenarioState.identityDeps([scenarioState.fixture.projectId], scenarioState.service),
        definedValue(scenarioState.historicalProof).input,
        {
          ...definedValue(scenarioState.historicalProof).authority,
          requiredCapabilities: [
            definedValue(
              definedValue(scenarioState.historicalProof).authority.requiredCapabilities[0],
            ),
          ],
        },
      ),
    ).toMatchObject({ useStatus: 'USABLE' });
    const refusedContextTarget = objectRef(
      'zhiju.execution.context_snapshot',
      newUuidV7(),
      scenarioState.scope(),
    ) as Common.ObjectRef;
    const refusedContext = await scenarioState.recoveryEnvelope(
      'frozenContextBuildV1_1',
      refusedContextTarget,
      { request: scenarioState.buildRequest } as unknown as CanonicalJsonObject,
      scenarioState.service,
    );
    await expect(
      scenarioState.recoveryEntryRaw.command(
        refusedContext,
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).rejects.toMatchObject({
      code: 'AUTHORIZATION_DECISION_INVALID',
    });
    expect(await scenarioState.contextSnapshotRow(refusedContextTarget.objectId)).toBeUndefined();
    expect(await scenarioState.receiptRows(String(refusedContext.idempotencyKey))).toEqual([]);
    const refusedBundleTarget = objectRef(
      'zhiju.identity.execution_capability_bundle',
      newUuidV7(),
      scenarioState.scope(),
    ) as Common.ObjectRef;
    const refusedBundle = await scenarioState.firstRunEnvelope(
      'identity.issue_execution_capability_bundle',
      refusedBundleTarget,
      scenarioState.bundle2Envelope.payload,
      scenarioState.service,
    );
    await expect(
      scenarioState.firstRunEntryRaw.issueBundle(
        refusedBundle,
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).rejects.toMatchObject({
      code: 'AUTHORIZATION_DECISION_INVALID',
    });
    expect(
      (
        await scenarioState.admin.query(
          'SELECT bundle_id FROM identity_policy.execution_capability_bundle WHERE bundle_id=$1',
          [refusedBundleTarget.objectId],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await scenarioState.admin.query(
          'SELECT command_id FROM identity_policy.command_receipt WHERE idempotency_key=$1',
          [refusedBundle.idempotencyKey],
        )
      ).rows,
    ).toEqual([]);
    await expect(
      scenarioState.firstRunEntryRaw.createRun(
        scenarioState.create2,
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).rejects.toMatchObject({
      code: 'AUTHORIZATION_DECISION_INVALID',
    });
    expect(
      (
        await scenarioState.admin.query('SELECT run_id FROM task_execution.run WHERE run_id=$1', [
          scenarioState.run2.objectId,
        ])
      ).rows,
    ).toEqual([]);
    expect(await scenarioState.receiptRows(scenarioState.create2.idempotencyKey)).toEqual([]);
    expect(await scenarioState.denialSnapshot()).toEqual(resolvedBeforeRevoke);
    expect(
      await scenarioState.revokeCapabilityTracked(
        scenarioState.identityDeps([scenarioState.fixture.projectId]),
        {
          targetId: remainingAnswerGrant,
          expectedAggregateVersion: '1',
          scope: {
            scopeKind: 'PROJECT',
            enterpriseId: scenarioState.fixture.enterpriseId,
            projectId: scenarioState.fixture.projectId,
          },
          reasonCode: 'WI232_R2_RESTORE_FULL_RIGHTS',
          effectiveAt: new Date(scenarioState.clock),
          idempotencyKey: newUuidV7(),
        },
      ),
    ).toMatchObject({ status: 'COMMITTED' });
    const restoredGrant = await scenarioState.grant({
      capabilityCode: scenarioState.recoveryConfig.humanCapabilityCodes.requestResolve,
      action: 'execution.information_request.resolve.v1',
      actions: [
        'execution.information_request.answer.submit.v1',
        'execution.information_request.resolve.v1',
      ],
      selectorType: 'TARGET_TYPE',
      targetObjectType: 'execution.information_request',
    });
    scenarioState.recoveryGrants.set(grantKey, restoredGrant);
    scenarioState.recoveryGrants.set(
      `${OPERATOR}:informationAnswerSubmitV1:execution.information_request`,
      restoredGrant,
    );
  }
  return false;
}
