import type { createControlledFirstRunEntry } from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import { type CanonicalJsonObject, hashContractPayload, newUuidV7 } from '@zhiju/shared-kernel';
import { expect } from 'vitest';
import { contentHash, type Principal, record } from './initial-context-fixtures.js';
import type {
  ScenarioFinalView,
  ScenarioFirstRunEnvelope,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifySubmissionBindingContext {
  readonly exercisePreparationMatrix: boolean;
  readonly attemptRef: Common.ObjectRef;
  readonly revised: Record<string, unknown>;
  fixture: InitialContextSuite['fixture'];
  readonly resultBody: Record<string, unknown>;
  readonly firstRunEnvelope: ScenarioFirstRunEnvelope;
  readonly resultTarget: Common.ObjectRef;
  readonly finalView: ScenarioFinalView;
  service: Principal;
  readonly firstRunEntry: ReturnType<typeof createControlledFirstRunEntry>;
  readonly sessionFor: InitialContextSuite['sessionFor'];
  readonly receiptRows: InitialContextSuite['receiptRows'];
  admin: InitialContextSuite['admin'];
  readonly runRef: Common.ObjectRef;
}

export async function verifySubmissionBinding(
  scenarioState: VerifySubmissionBindingContext,
): Promise<boolean> {
  if (scenarioState.exercisePreparationMatrix) {
    const alteredCases: readonly (readonly [string, (body: Record<string, unknown>) => void])[] = [
      [
        'Run Ref',
        (body) => {
          body.runRef = { ...record(body.runRef), objectId: newUuidV7() };
        },
      ],
      [
        'WorkOrder Ref',
        (body) => {
          body.workOrderRef = { ...record(body.workOrderRef), objectId: newUuidV7() };
        },
      ],
      [
        'Task Ref',
        (body) => {
          body.taskRef = { ...record(body.taskRef), objectId: newUuidV7() };
        },
      ],
      [
        'Project Ref',
        (body) => {
          body.projectRef = { ...record(body.projectRef), objectId: newUuidV7() };
        },
      ],
      [
        'Adapter identity Ref',
        (body) => {
          body.submittedByRuntime = {
            ...record(body.submittedByRuntime),
            objectId: newUuidV7(),
          };
        },
      ],
      [
        'Attempt Ref as Adapter identity',
        (body) => {
          body.submittedByRuntime = scenarioState.attemptRef;
        },
      ],
      [
        'static Adapter selector as instance identity',
        (body) => {
          body.submittedByRuntime = record(
            scenarioState.revised.versionPins,
          ).runtimeAdapterContractRef;
        },
      ],
      [
        'Context Ref',
        (body) => {
          const provenance = record(body.provenance);
          provenance.contextSnapshotRef = {
            ...record(provenance.contextSnapshotRef),
            objectId: newUuidV7(),
          };
        },
      ],
      [
        'Bundle Ref',
        (body) => {
          const provenance = record(body.provenance);
          provenance.capabilityGrantRef = {
            ...record(provenance.capabilityGrantRef),
            objectId: newUuidV7(),
          };
        },
      ],
      [
        'runtime session Ref',
        (body) => {
          const provenance = record(body.provenance);
          provenance.runtimeSessionExternalRef = {
            ...record(provenance.runtimeSessionExternalRef),
            externalId: newUuidV7(),
          };
        },
      ],
      [
        'Header Scope',
        (body) => {
          const header = record(body.header);
          header.scopeRef = {
            enterpriseId: scenarioState.fixture.enterpriseId,
            projectId: newUuidV7(),
          };
        },
      ],
    ];
    for (const [label, mutate] of alteredCases) {
      const altered = structuredClone(scenarioState.resultBody);
      mutate(altered);
      record(altered.header).payloadHash = contentHash(
        hashContractPayload(altered as unknown as CanonicalJsonObject),
      );
      const invalidSubmit = await scenarioState.firstRunEnvelope(
        'execution.submit_agent_result',
        scenarioState.resultTarget,
        {
          agentResultContract: altered,
          runFencingToken: 1,
          runtimeSubmissionRef: scenarioState.finalView.runtimeSubmissionRef,
        } as unknown as CanonicalJsonObject,
        scenarioState.service,
      );
      await expect(
        scenarioState.firstRunEntry.submitAgentResult(
          invalidSubmit,
          scenarioState.sessionFor(scenarioState.service),
        ),
        label,
      ).rejects.toBeDefined();
      expect(await scenarioState.receiptRows(invalidSubmit.idempotencyKey), label).toEqual([]);
    }
    const wrongFencing = await scenarioState.firstRunEnvelope(
      'execution.submit_agent_result',
      scenarioState.resultTarget,
      {
        agentResultContract: scenarioState.resultBody,
        runFencingToken: 2,
        runtimeSubmissionRef: scenarioState.finalView.runtimeSubmissionRef,
      } as unknown as CanonicalJsonObject,
      scenarioState.service,
    );
    await expect(
      scenarioState.firstRunEntry.submitAgentResult(
        wrongFencing,
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).rejects.toBeDefined();
    expect(await scenarioState.receiptRows(wrongFencing.idempotencyKey)).toEqual([]);
    expect(
      (
        await scenarioState.admin.query<{ count: string }>(
          'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
          [scenarioState.runRef.objectId],
        )
      ).rows,
    ).toEqual([{ count: '0' }]);
  }
  return false;
}
