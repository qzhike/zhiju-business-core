import type { createControlledFirstRunEntry } from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import { type CanonicalJsonObject, newUuidV7 } from '@zhiju/shared-kernel';
import type { CommandResult } from '@zhiju/task-execution';
import { expect } from 'vitest';
import { definedValue, objectRef, type Principal, record } from './initial-context-fixtures.js';
import type {
  ScenarioFirstRunEnvelope,
  ScenarioFirstRunQuery,
  ScenarioRuntimeBinding,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifyRecoveryChildBindingContext {
  readonly otherChildId: string | undefined;
  otherChildContract: Record<string, unknown> | undefined;
  readonly scope: InitialContextSuite['scope'];
  readonly firstRunEntryRaw: ReturnType<typeof createControlledFirstRunEntry>;
  readonly firstRunEnvelope: ScenarioFirstRunEnvelope;
  readonly controlsRef: Common.VersionedRef;
  readonly operator: InitialContextSuite['operator'];
  readonly sessionFor: InitialContextSuite['sessionFor'];
  otherChildContractRef: unknown;
  otherChildContextRef: unknown;
  readonly serviceId: string;
  service: Principal;
  readonly committedPayload: InitialContextSuite['committedPayload'];
  admin: InitialContextSuite['admin'];
  clock: InitialContextSuite['clock'];
  readonly runtimeBinding: ScenarioRuntimeBinding;
  otherChildAttemptRef: Common.ObjectRef | undefined;
  readonly firstRunQuery: ScenarioFirstRunQuery;
  otherChildResultRef: unknown;
  readonly finalEvaluator: Common.VersionedRef | undefined;
}

export async function verifyRecoveryChildBinding(
  scenarioState: VerifyRecoveryChildBindingContext,
): Promise<boolean> {
  if (scenarioState.otherChildId) {
    const child = definedValue(scenarioState.otherChildContract);
    const childRef = child.workOrderRef as Common.ObjectRef;
    const childRun = objectRef(
      'execution.run',
      newUuidV7(),
      scenarioState.scope(),
    ) as Common.ObjectRef;
    expect(
      await scenarioState.firstRunEntryRaw.queue(
        await scenarioState.firstRunEnvelope(
          'execution.queue_work_order',
          childRef,
          {
            queuePolicyRef: scenarioState.controlsRef,
          } as unknown as CanonicalJsonObject,
          scenarioState.operator(),
          2,
        ),
        scenarioState.sessionFor(),
      ),
    ).toMatchObject({ status: 'COMMITTED' });
    const bundle = await scenarioState.firstRunEntryRaw.issueBundle(
      await scenarioState.firstRunEnvelope(
        'identity.issue_execution_capability_bundle',
        objectRef(
          'zhiju.identity.execution_capability_bundle',
          newUuidV7(),
          scenarioState.scope(),
        ) as Common.ObjectRef,
        {
          runRef: childRun,
          workOrderRef: childRef,
          workOrderContractRef: scenarioState.otherChildContractRef,
          contextSnapshotRef: scenarioState.otherChildContextRef,
          servicePrincipalRef: { principalKind: 'SERVICE', principalId: scenarioState.serviceId },
          requestedCapabilities: child.allowedCapabilities,
        } as unknown as CanonicalJsonObject,
        scenarioState.service,
      ),
      scenarioState.sessionFor(scenarioState.service),
    );
    const capability = record(scenarioState.committedPayload(bundle as CommandResult)).bundleRef;
    const validUntil = definedValue(
      (
        await scenarioState.admin.query<{ valid_until: Date }>(
          'SELECT valid_until FROM identity_policy.execution_capability_bundle WHERE bundle_id=$1',
          [record(capability).objectId],
        )
      ).rows[0],
    ).valid_until;
    scenarioState.clock = Math.max(scenarioState.clock, Date.now());
    const created = await scenarioState.firstRunEntryRaw.createRun(
      await scenarioState.firstRunEnvelope(
        'execution.create_run',
        childRun,
        {
          creation: {
            workOrderRef: childRef,
            workOrderContractRef: scenarioState.otherChildContractRef,
            contextSnapshotRef: scenarioState.otherChildContextRef,
            capabilityGrantRef: capability,
            leasePolicyRef: scenarioState.controlsRef,
            attemptNumber: 1,
            runtimeBinding: scenarioState.runtimeBinding,
            executionDeadline: validUntil.toISOString(),
          },
        } as unknown as CanonicalJsonObject,
        scenarioState.service,
      ),
      scenarioState.sessionFor(scenarioState.service),
    );
    const creation = record(scenarioState.committedPayload(created as CommandResult));
    scenarioState.otherChildAttemptRef = objectRef(
      'integration.runtime_attempt',
      newUuidV7(),
      scenarioState.scope(),
    ) as Common.ObjectRef;
    expect(
      await scenarioState.firstRunEntryRaw.dispatch(
        await scenarioState.firstRunEnvelope(
          'integration.request_runtime_dispatch',
          scenarioState.otherChildAttemptRef,
          {
            request: {
              workOrderRef: childRef,
              runRef: childRun,
              workOrderContractRef: scenarioState.otherChildContractRef,
              contextSnapshotRef: scenarioState.otherChildContextRef,
              capabilityGrantRef: capability,
              runtimeBinding: scenarioState.runtimeBinding,
              stableIdempotencyKey: newUuidV7(),
              requestedAt: new Date(scenarioState.clock).toISOString(),
            },
          } as unknown as CanonicalJsonObject,
          scenarioState.service,
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({ status: 'SUCCEEDED' });
    expect(
      await scenarioState.firstRunEntryRaw.startRun(
        await scenarioState.firstRunEnvelope(
          'execution.start_run',
          childRun,
          {
            leaseId: creation.leaseId,
            fencingToken: 1,
            runtimeAttemptRef: scenarioState.otherChildAttemptRef,
            startedAt: new Date(scenarioState.clock).toISOString(),
          } as unknown as CanonicalJsonObject,
          scenarioState.service,
          1,
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({ status: 'COMMITTED' });
    expect(
      await scenarioState.firstRunEntryRaw.reconcile(
        await scenarioState.firstRunEnvelope(
          'execution.reconcile_work_order_execution',
          childRef,
          { triggerRef: childRun } as unknown as CanonicalJsonObject,
          scenarioState.service,
          3,
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({ status: 'COMMITTED', resultPayload: { status: 'RUNNING' } });
    const final = definedValue(
      await scenarioState.firstRunEntryRaw.observeRuntimeFinal(
        await scenarioState.firstRunQuery(
          'integration.get_runtime_final_observation',
          scenarioState.otherChildAttemptRef,
          { attemptRef: scenarioState.otherChildAttemptRef } as unknown as CanonicalJsonObject,
          'runtimeFinalReadV1',
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    );
    expect(record(final.agentResultContract).executionOutcome).toBe('BLOCKED_INPUT');
    const submitted = await scenarioState.firstRunEntryRaw.submitAgentResult(
      await scenarioState.firstRunEnvelope(
        'execution.submit_agent_result',
        objectRef(
          'execution.agent_result',
          String(record(final.agentResultContract).agentResultId),
          scenarioState.scope(),
        ) as Common.ObjectRef,
        {
          agentResultContract: final.agentResultContract,
          runFencingToken: 1,
          runtimeSubmissionRef: final.runtimeSubmissionRef,
        },
        scenarioState.service,
      ),
      scenarioState.sessionFor(scenarioState.service),
    );
    scenarioState.otherChildResultRef = record(
      scenarioState.committedPayload(submitted as CommandResult),
    ).agentResultRef;
    expect(
      await scenarioState.firstRunEntryRaw.recordRunResult(
        await scenarioState.firstRunEnvelope(
          'execution.record_run_result',
          childRun,
          { agentResultRef: scenarioState.otherChildResultRef } as CanonicalJsonObject,
          scenarioState.service,
          2,
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({ status: 'COMMITTED' });
    const validated = await scenarioState.firstRunEntryRaw.validateAgentResult(
      await scenarioState.firstRunEnvelope(
        'execution.validate_agent_result',
        objectRef(
          'zhiju.execution.agent_result_validation_bundle',
          newUuidV7(),
          scenarioState.scope(),
        ) as Common.ObjectRef,
        {
          agentResultRef: scenarioState.otherChildResultRef,
          runRef: childRun,
          runtimeAttemptRef: scenarioState.otherChildAttemptRef,
          policyRef: scenarioState.controlsRef,
          evaluatorRef: scenarioState.finalEvaluator,
        } as unknown as CanonicalJsonObject,
        scenarioState.service,
      ),
      scenarioState.sessionFor(scenarioState.service),
    );
    const judgments = record(scenarioState.committedPayload(validated as CommandResult));
    const accepted = await scenarioState.firstRunEntryRaw.acceptAgentResult(
      await scenarioState.firstRunEnvelope(
        'execution.accept_agent_result',
        objectRef(
          'execution.agent_result_acceptance',
          newUuidV7(),
          scenarioState.scope(),
        ) as Common.ObjectRef,
        {
          agentResultRef: scenarioState.otherChildResultRef,
          schemaValidationRef: judgments.schemaValidationRef,
          identityValidationRef: judgments.identityValidationRef,
          runBindingValidationRef: judgments.runBindingValidationRef,
          scopeValidationRef: judgments.scopeValidationRef,
          businessOutputValidationRef: judgments.businessOutputValidationRef,
          disposition: 'ACCEPTED',
          reasons: [],
        } as unknown as CanonicalJsonObject,
        scenarioState.service,
      ),
      scenarioState.sessionFor(scenarioState.service),
    );
    const acceptance = record(
      scenarioState.committedPayload(accepted as CommandResult),
    ).acceptanceRecordRef;
    expect(
      await scenarioState.firstRunEntryRaw.finalizeRun(
        await scenarioState.firstRunEnvelope(
          'execution.finalize_run_from_acceptance',
          childRun,
          { acceptanceRecordRef: acceptance } as CanonicalJsonObject,
          scenarioState.service,
          3,
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({ status: 'COMMITTED' });
    expect(
      await scenarioState.firstRunEntryRaw.reconcile(
        await scenarioState.firstRunEnvelope(
          'execution.reconcile_work_order_execution',
          childRef,
          { triggerRef: childRun } as unknown as CanonicalJsonObject,
          scenarioState.service,
          4,
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({ status: 'COMMITTED', resultPayload: { status: 'WAITING_INPUT' } });
  }
  return false;
}
