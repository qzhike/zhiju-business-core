import type {
  ControlledFinalRecoveryWorker,
  createControlledFirstRunEntry,
  createFormalCompletionEntry,
  createRecoveryProcessAuthorities,
} from '@zhiju/api/composition';
import { createBlockedInputRecoveryEntry } from '@zhiju/api/composition';
import type { Common, IntegrationGateway } from '@zhiju/contracts';
import type { createRecoveryAuthorizationPort } from '@zhiju/identity-policy';
import {
  BLOCKED_INPUT_RECOVERY_BINDINGS,
  readRecoveryHumanEligibility,
  type RecoveryHumanEligibilityInput,
  revokeRole,
} from '@zhiju/identity-policy';
import type { LocalSyntheticRuntimeDriver } from '@zhiju/integration-gateway';
import type { UuidV7 } from '@zhiju/shared-kernel';
import {
  canonicalize,
  type CanonicalJsonObject,
  newUuidV7,
  sha256CanonicalJson,
} from '@zhiju/shared-kernel';
import {
  blockedInputRecoveryProcessId,
  type CommandResult,
  digestCanonicalPayload,
  readBlockedInputRecoveryProgress,
  type TaskExecutionDb,
  withTaskExecutionTransaction,
} from '@zhiju/task-execution';
import { type Kysely, type KyselyPlugin, sql } from 'kysely';
import pg from 'pg';
import { expect } from 'vitest';
import {
  AUTH_HASH,
  BUILDER_PROFILE,
  contentHash,
  definedValue,
  objectRef,
  OPERATOR,
  type Principal,
  profileReference,
  PURPOSE_DOCUMENT,
  record,
  WORK_ORDER_V11,
} from './initial-context-fixtures.js';
import type {
  ScenarioBoardProbe,
  ScenarioFinalView,
  ScenarioFirstRunEnvelope,
  ScenarioFirstRunQuery,
  ScenarioFormalEnvelope,
  ScenarioRead,
  ScenarioRecoveryConfig,
  ScenarioRecoveryEnvelope,
  ScenarioRecoveryVariant,
  ScenarioRuntimeBinding,
  ScenarioTerminalScenario,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
import {
  verifyRecoveryChildBinding,
  type VerifyRecoveryChildBindingContext,
} from './initial-context-verify-recovery-child-binding.js';
import {
  verifyRecoveryCompletionRace,
  type VerifyRecoveryCompletionRaceContext,
} from './initial-context-verify-recovery-completion-race.js';
import {
  verifyRecoveryResolutionFaults,
  type VerifyRecoveryResolutionFaultsContext,
} from './initial-context-verify-recovery-resolution-faults.js';
import {
  verifySecondRunCreationFaults,
  type VerifySecondRunCreationFaultsContext,
} from './initial-context-verify-second-run-creation-faults.js';
export interface VerifyBoundedRecoveryContext {
  readonly boardProbe?: ScenarioBoardProbe | undefined;
  readonly bounded: boolean;
  readonly phase: InitialContextSuite['phase'];
  processEnabled: boolean;
  readonly scope: InitialContextSuite['scope'];
  admin: InitialContextSuite['admin'];
  readonly runRef: Common.ObjectRef;
  readonly resultBody: Record<string, unknown>;
  readonly revised: Record<string, unknown>;
  readonly workOrderRef: Common.ObjectRef;
  readonly resultRef: Common.ContentAddressedRef;
  readonly acceptanceRecordRef: unknown;
  candidateMaterial: Common.VersionedRef | undefined;
  recoverySource: Common.ContentAddressedRef | undefined;
  clock: InitialContextSuite['clock'];
  service: Principal;
  readonly recoveryEnvelope: ScenarioRecoveryEnvelope;
  readonly recoveryEntryRaw: ReturnType<typeof createBlockedInputRecoveryEntry>;
  readonly sessionFor: InitialContextSuite['sessionFor'];
  readonly receiptRows: InitialContextSuite['receiptRows'];
  readonly exerciseRecoveryFaultMatrix: boolean;
  readonly controlsRef: Common.VersionedRef;
  readonly operator: InitialContextSuite['operator'];
  readonly firstRunEntryRaw: ReturnType<typeof createControlledFirstRunEntry>;
  readonly firstRunEnvelope: ScenarioFirstRunEnvelope;
  readonly terminalScenario: ScenarioTerminalScenario;
  readonly taskId: string;
  readonly formalEnvelope: ScenarioFormalEnvelope;
  readonly completionRef: Common.VersionedRef;
  activeDatabaseUrl: InitialContextSuite['activeDatabaseUrl'];
  readonly formalEntry: ReturnType<typeof createFormalCompletionEntry>;
  readonly recoveryEntry: ReturnType<typeof createBlockedInputRecoveryEntry>;
  readonly woId: string;
  readonly firstRunEntry: ReturnType<typeof createControlledFirstRunEntry>;
  readonly otherChildId: string | undefined;
  otherChildContract: Record<string, unknown> | undefined;
  otherChildContractRef: unknown;
  otherChildContextRef: unknown;
  readonly serviceId: string;
  readonly committedPayload: InitialContextSuite['committedPayload'];
  readonly runtimeBinding: ScenarioRuntimeBinding;
  otherChildAttemptRef: Common.ObjectRef | undefined;
  readonly firstRunQuery: ScenarioFirstRunQuery;
  otherChildResultRef: unknown;
  readonly finalEvaluator: Common.VersionedRef | undefined;
  readonly recoveryAuth: ReturnType<typeof createRecoveryAuthorizationPort>;
  readonly identityDeps: InitialContextSuite['identityDeps'];
  fixture: InitialContextSuite['fixture'];
  readonly queryReads: string[];
  readonly recoveryConfig: ScenarioRecoveryConfig;
  readonly guardedTeDb: Kysely<TaskExecutionDb>;
  readonly recoveryCodes: Record<string, string>;
  readonly protectedReads: () => string[];
  readonly borrowedActors: Principal[];
  readonly recoveryGrants: Map<string, string>;
  readonly revokeCapabilityTracked: InitialContextSuite['revokeCapabilityTracked'];
  readonly grant: InitialContextSuite['grant'];
  readonly recoveryReceiptRollback: (
    envelope: Record<string, unknown>,
    execute: () => Promise<unknown>,
  ) => Promise<void>;
  recoveryProposeEnvelope: Record<string, unknown> | undefined;
  readonly other: InitialContextSuite['other'];
  identityDb: InitialContextSuite['identityDb'];
  readonly captureSlice: InitialContextSuite['captureSlice'];
  readonly captureRef: Common.VersionedRef;
  readonly contextSnapshotBuildRow: InitialContextSuite['contextSnapshotBuildRow'];
  readonly contextRef: Common.SnapshotRef;
  readonly read: ScenarioRead;
  readonly contextSnapshotRow: InitialContextSuite['contextSnapshotRow'];
  readonly recoveryVariant: ScenarioRecoveryVariant;
  readonly registry: InitialContextSuite['registry'];
  readonly slice: Common.ContentAddressedRef;
  readonly recoveryBuilderRef: Common.VersionedRef;
  readonly registerPolicyVersionAs: InitialContextSuite['registerPolicyVersionAs'];
  processPending: CanonicalJsonObject | undefined;
  processExecute: ((command: CanonicalJsonObject) => Promise<unknown>) | undefined;
  processWorkers: ControlledFinalRecoveryWorker[] | undefined;
  readonly processAuthorities: Awaited<ReturnType<typeof createRecoveryProcessAuthorities>>[];
  readonly throughRecoveryProcess: (
    envelope: Record<string, unknown>,
    execute: (command: CanonicalJsonObject) => Promise<unknown>,
  ) => Promise<unknown>;
  teDb: InitialContextSuite['teDb'];
  readonly proposalId: UuidV7;
  readonly runtimeDriver: LocalSyntheticRuntimeDriver;
  readonly attemptRef: Common.ObjectRef;
  readonly attemptRead: InitialContextSuite['attemptRead'];
  readonly preparedRead: InitialContextSuite['preparedRead'];
  processResult: unknown;
  faultFirstRunCommands: boolean;
  readonly shortRecoveryBudget: boolean;
  readonly progress: InitialContextSuite['progress'];
  readonly bundleRef: unknown;
  readonly waitForDeadline: InitialContextSuite['waitForDeadline'];
  readonly formal: boolean;
  readonly createAndReleaseFormalOutput: (
    actualRun: Common.ObjectRef,
    actualAttempt: Common.ObjectRef,
  ) => Promise<CanonicalJsonObject>;
  readonly resultTarget: Common.ObjectRef;
  readonly finalView: ScenarioFinalView;
  otherDraftChildId: string | undefined;
  readonly runnerContext: InitialContextSuite['runnerContext'];
  enterpriseProjectDb: InitialContextSuite['enterpriseProjectDb'];
  processStep: number;
  readonly processHandoffs: Set<number>;
  readonly attemptBinding: IntegrationGateway.IntegrationGetRuntimeAttemptBindingResult;
  readonly completeFormal: () => Promise<void>;
}

export async function verifyBoundedRecovery(
  scenarioState: VerifyBoundedRecoveryContext,
): Promise<boolean> {
  if (scenarioState.bounded) {
    const stageDependencies: VerifyRecoveryCompletionRaceContext &
      VerifyRecoveryChildBindingContext &
      VerifyRecoveryResolutionFaultsContext &
      VerifySecondRunCreationFaultsContext = {
      get terminalScenario() {
        return scenarioState.terminalScenario;
      },
      get admin() {
        return scenarioState.admin;
      },
      set admin(value: typeof scenarioState.admin) {
        scenarioState.admin = value;
      },
      get taskId() {
        return scenarioState.taskId;
      },
      get recoveryEntryRaw() {
        return scenarioState.recoveryEntryRaw;
      },
      get recoveryEnvelope() {
        return scenarioState.recoveryEnvelope;
      },
      get revised() {
        return scenarioState.revised;
      },
      get runRef() {
        return scenarioState.runRef;
      },
      get service() {
        return scenarioState.service;
      },
      set service(value: typeof scenarioState.service) {
        scenarioState.service = value;
      },
      get sessionFor() {
        return scenarioState.sessionFor;
      },
      get formalEnvelope() {
        return scenarioState.formalEnvelope;
      },
      get completionRef() {
        return scenarioState.completionRef;
      },
      get activeDatabaseUrl() {
        return scenarioState.activeDatabaseUrl;
      },
      set activeDatabaseUrl(value: typeof scenarioState.activeDatabaseUrl) {
        scenarioState.activeDatabaseUrl = value;
      },
      get formalEntry() {
        return scenarioState.formalEntry;
      },
      get receiptRows() {
        return scenarioState.receiptRows;
      },
      get open() {
        return open;
      },
      get requestRef() {
        return requestRef;
      },
      get otherChildId() {
        return scenarioState.otherChildId;
      },
      get otherChildContract() {
        return scenarioState.otherChildContract;
      },
      set otherChildContract(value: typeof scenarioState.otherChildContract) {
        scenarioState.otherChildContract = value;
      },
      get scope() {
        return scenarioState.scope;
      },
      get firstRunEntryRaw() {
        return scenarioState.firstRunEntryRaw;
      },
      get firstRunEnvelope() {
        return scenarioState.firstRunEnvelope;
      },
      get controlsRef() {
        return scenarioState.controlsRef;
      },
      get operator() {
        return scenarioState.operator;
      },
      get otherChildContractRef() {
        return scenarioState.otherChildContractRef;
      },
      set otherChildContractRef(value: typeof scenarioState.otherChildContractRef) {
        scenarioState.otherChildContractRef = value;
      },
      get otherChildContextRef() {
        return scenarioState.otherChildContextRef;
      },
      set otherChildContextRef(value: typeof scenarioState.otherChildContextRef) {
        scenarioState.otherChildContextRef = value;
      },
      get serviceId() {
        return scenarioState.serviceId;
      },
      get committedPayload() {
        return scenarioState.committedPayload;
      },
      get clock() {
        return scenarioState.clock;
      },
      set clock(value: typeof scenarioState.clock) {
        scenarioState.clock = value;
      },
      get runtimeBinding() {
        return scenarioState.runtimeBinding;
      },
      get otherChildAttemptRef() {
        return scenarioState.otherChildAttemptRef;
      },
      set otherChildAttemptRef(value: typeof scenarioState.otherChildAttemptRef) {
        scenarioState.otherChildAttemptRef = value;
      },
      get firstRunQuery() {
        return scenarioState.firstRunQuery;
      },
      get otherChildResultRef() {
        return scenarioState.otherChildResultRef;
      },
      set otherChildResultRef(value: typeof scenarioState.otherChildResultRef) {
        scenarioState.otherChildResultRef = value;
      },
      get finalEvaluator() {
        return scenarioState.finalEvaluator;
      },
      get exerciseRecoveryFaultMatrix() {
        return scenarioState.exerciseRecoveryFaultMatrix;
      },
      get resolutionRef() {
        return resolutionRef;
      },
      get recoveryCodes() {
        return scenarioState.recoveryCodes;
      },
      get identityDeps() {
        return scenarioState.identityDeps;
      },
      get fixture() {
        return scenarioState.fixture;
      },
      set fixture(value: typeof scenarioState.fixture) {
        scenarioState.fixture = value;
      },
      get recoveryConfig() {
        return scenarioState.recoveryConfig;
      },
      get historicalProof() {
        return historicalProof;
      },
      set historicalProof(value: typeof historicalProof) {
        historicalProof = value;
      },
      get identityDb() {
        return scenarioState.identityDb;
      },
      set identityDb(value: typeof scenarioState.identityDb) {
        scenarioState.identityDb = value;
      },
      get revokeCapabilityTracked() {
        return scenarioState.revokeCapabilityTracked;
      },
      get grant() {
        return scenarioState.grant;
      },
      get confirmationIssuedAt() {
        return confirmationIssuedAt;
      },
      get recoveryProposeEnvelope() {
        return scenarioState.recoveryProposeEnvelope;
      },
      set recoveryProposeEnvelope(value: typeof scenarioState.recoveryProposeEnvelope) {
        scenarioState.recoveryProposeEnvelope = value;
      },
      get resolvePayload() {
        return resolvePayload;
      },
      get recoveryEntry() {
        return scenarioState.recoveryEntry;
      },
      get denialSnapshot() {
        return denialSnapshot;
      },
      get recoveryGrants() {
        return scenarioState.recoveryGrants;
      },
      get buildRequest() {
        return buildRequest;
      },
      get contextSnapshotRow() {
        return scenarioState.contextSnapshotRow;
      },
      get bundle2Envelope() {
        return bundle2Envelope;
      },
      get create2() {
        return create2;
      },
      get run2() {
        return run2;
      },
    };

    scenarioState.phase('bounded recovery after terminal Run-1');
    scenarioState.processEnabled = true;
    const requestRef = objectRef(
      'execution.information_request',
      newUuidV7(),
      scenarioState.scope(),
    ) as Common.ObjectRef;
    const savedHistory = await scenarioState.admin.query(
      `SELECT to_jsonb(r) run_bytes,a.result_payload result_bytes,ac.canonical_payload acceptance_bytes,c.canonical_payload context_bytes,wc.canonical_payload contract_bytes,r.result_ref,r.acceptance_ref,r.context_snapshot_ref,r.work_order_contract_ref,c.payload_hash context_hash,wc.payload_hash contract_hash FROM task_execution.run r JOIN task_execution.agent_result a USING(run_id) JOIN task_execution.agent_result_acceptance ac USING(result_id) JOIN task_execution.context_snapshot c ON c.snapshot_id=(r.context_snapshot_ref->>'snapshotId')::uuid JOIN task_execution.work_order_contract wc ON wc.contract_id=(r.work_order_contract_ref->>'objectId')::uuid WHERE r.run_id=$1`,
      [scenarioState.runRef.objectId],
    );
    const proposal = record(
      (scenarioState.resultBody.inputRequestProposals as CanonicalJsonObject[])[0],
    );
    const canonicalRefs = (values: unknown[]) =>
      values.sort((a, b) =>
        Buffer.compare(
          Buffer.from(canonicalize(a as CanonicalJsonObject)),
          Buffer.from(canonicalize(b as CanonicalJsonObject)),
        ),
      );
    const definition = {
      taskRef: scenarioState.revised.taskRef,
      workOrderRef: scenarioState.workOrderRef,
      runRef: scenarioState.runRef,
      requestType: proposal.requestType,
      question: proposal.question,
      reason: proposal.reason,
      expectedAnswerSpec: proposal.expectedAnswerSpec,
      blocking: true,
      requestedResponder: {
        principalKind: 'HUMAN',
        roleCode: 'project.customer_material.confirmer',
        scopeRef: scenarioState.scope(),
      },
      relatedRefs: canonicalRefs([
        scenarioState.resultRef,
        scenarioState.acceptanceRecordRef,
        scenarioState.candidateMaterial,
        scenarioState.recoverySource,
        scenarioState.workOrderRef,
        scenarioState.revised.taskRef,
      ]),
      expiresAt: new Date(scenarioState.clock + 300_000).toISOString(),
    };
    const rejectRecovery = async (
      key: string,
      target: Common.ObjectRef,
      payload: CanonicalJsonObject,
      principal: Principal = scenarioState.service,
      expectedVersion?: number,
    ) => {
      const envelope = await scenarioState.recoveryEnvelope(
        key,
        target,
        payload,
        principal,
        expectedVersion,
      );
      await expect(
        scenarioState.recoveryEntryRaw.command(envelope, scenarioState.sessionFor(principal)),
        `${key} rejection`,
      ).rejects.toBeDefined();
      expect(await scenarioState.receiptRows(String(envelope.idempotencyKey))).toEqual([]);
    };
    if (scenarioState.exerciseRecoveryFaultMatrix) {
      const stateBeforeRequest = await scenarioState.recoveryEntryRaw.read(
        await scenarioState.recoveryEnvelope(
          'workOrderExecutionStateReadV1',
          scenarioState.workOrderRef,
          { workOrderRef: scenarioState.workOrderRef } as unknown as CanonicalJsonObject,
          scenarioState.service,
          undefined,
          true,
        ),
        scenarioState.sessionFor(scenarioState.service),
      );
      expect(stateBeforeRequest).toMatchObject({
        blockerRefs: [scenarioState.resultRef],
        retryEligibility: 'WAITING_INPUT',
      });
      await rejectRecovery(
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
      // Both Roots derive WAITING_INPUT from the terminal source before a Request exists.
      expect(
        await scenarioState.firstRunEntryRaw.reconcile(
          await scenarioState.firstRunEnvelope(
            'execution.reconcile_work_order_execution',
            scenarioState.workOrderRef,
            { triggerRef: scenarioState.runRef } as unknown as CanonicalJsonObject,
            scenarioState.service,
            Number(record(stateBeforeRequest).aggregateVersion),
          ),
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).toMatchObject({ status: 'COMMITTED', resultPayload: { status: 'WAITING_INPUT' } });
      const taskBeforeRequest = await scenarioState.recoveryEntryRaw.read(
        await scenarioState.recoveryEnvelope(
          'taskStateReadV1',
          scenarioState.revised.taskRef as Common.ObjectRef,
          { taskRef: scenarioState.revised.taskRef } as unknown as CanonicalJsonObject,
          scenarioState.service,
          undefined,
          true,
        ),
        scenarioState.sessionFor(scenarioState.service),
      );
      expect(
        await scenarioState.recoveryEntryRaw.command(
          await scenarioState.recoveryEnvelope(
            'taskReconcileV1',
            scenarioState.revised.taskRef as Common.ObjectRef,
            { triggerRef: scenarioState.runRef } as unknown as CanonicalJsonObject,
            scenarioState.service,
            Number(record(taskBeforeRequest).aggregateVersion),
          ),
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).toMatchObject({ status: 'COMMITTED', resultPayload: { status: 'WAITING_INPUT' } });
    }
    definition.expiresAt = new Date(scenarioState.clock + 300_000).toISOString();
    const open = await scenarioState.recoveryEnvelope(
      'informationRequestOpenV1',
      requestRef,
      { definition } as unknown as CanonicalJsonObject,
      scenarioState.service,
    );
    if (await verifyRecoveryCompletionRace(stageDependencies)) return true;
    expect(
      await scenarioState.recoveryEntry.command(
        open,
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({
      status: scenarioState.terminalScenario.startsWith('FORMAL_REQUEST_')
        ? 'DUPLICATE'
        : 'COMMITTED',
    });
    if (scenarioState.exerciseRecoveryFaultMatrix) {
      expect(
        await scenarioState.recoveryEntry.command(
          open,
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).toMatchObject({
        status: 'DUPLICATE',
      });
      // A different target/key for the same accepted source returns the original winner.
      const alternateOpen = await scenarioState.recoveryEnvelope(
        'informationRequestOpenV1',
        objectRef(
          'execution.information_request',
          newUuidV7(),
          scenarioState.scope(),
        ) as Common.ObjectRef,
        { definition } as unknown as CanonicalJsonObject,
        scenarioState.service,
      );
      expect(
        await scenarioState.recoveryEntryRaw.command(
          alternateOpen,
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).toMatchObject({
        status: 'COMMITTED',
        resultPayload: { informationRequestRef: requestRef },
      });
      expect(
        (
          await scenarioState.admin.query(
            'SELECT request_id FROM task_execution.information_request_origin WHERE source_result_id=$1',
            [scenarioState.resultRef.objectId],
          )
        ).rows,
      ).toEqual([{ request_id: requestRef.objectId }]);
      await rejectRecovery(
        'informationRequestOpenV1',
        objectRef(
          'execution.information_request',
          newUuidV7(),
          scenarioState.scope(),
        ) as Common.ObjectRef,
        {
          definition: { ...definition, question: 'A conflicting request question.' },
        } as unknown as CanonicalJsonObject,
      );
    }
    await scenarioState.boardProbe?.('REQUEST_OPEN', scenarioState.runRef);
    const requestQuery = async () =>
      scenarioState.recoveryEntry.read(
        await scenarioState.recoveryEnvelope(
          'informationRequestReadV1',
          requestRef,
          { informationRequestRef: requestRef } as unknown as CanonicalJsonObject,
          scenarioState.operator(),
          undefined,
          true,
        ),
        scenarioState.sessionFor(),
      );
    expect(await requestQuery()).toMatchObject({
      status: 'OPEN',
      aggregateVersion: 1,
      deliveryRefs: [],
    });
    const woVersion = async () =>
      Number(
        definedValue(
          (
            await scenarioState.admin.query<{ aggregate_version: string }>(
              'SELECT aggregate_version FROM task_execution.work_order WHERE work_order_id=$1',
              [scenarioState.woId],
            )
          ).rows[0],
        ).aggregate_version,
      );
    const taskVersion = async () =>
      Number(
        definedValue(
          (
            await scenarioState.admin.query<{ aggregate_version: string }>(
              'SELECT aggregate_version FROM task_execution.task WHERE task_id=$1',
              [scenarioState.taskId],
            )
          ).rows[0],
        ).aggregate_version,
      );
    const reconcileWo = async (trigger: unknown) =>
      scenarioState.firstRunEntry.reconcile(
        await scenarioState.firstRunEnvelope(
          'execution.reconcile_work_order_execution',
          scenarioState.workOrderRef,
          { triggerRef: trigger } as unknown as CanonicalJsonObject,
          scenarioState.service,
          await woVersion(),
        ),
        scenarioState.sessionFor(scenarioState.service),
      );
    const reconcileTask = async (trigger: unknown) =>
      scenarioState.recoveryEntry.command(
        await scenarioState.recoveryEnvelope(
          'taskReconcileV1',
          scenarioState.revised.taskRef as Common.ObjectRef,
          { triggerRef: trigger } as unknown as CanonicalJsonObject,
          scenarioState.service,
          await taskVersion(),
        ),
        scenarioState.sessionFor(scenarioState.service),
      );
    expect(await reconcileWo(scenarioState.runRef)).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { status: 'WAITING_INPUT' },
    });
    expect(await reconcileTask(scenarioState.runRef)).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { status: 'WAITING_INPUT' },
    });
    if (await verifyRecoveryChildBinding(stageDependencies)) return true;
    scenarioState.clock = Math.max(scenarioState.clock, Date.now());
    scenarioState.phase('bounded recovery: material confirmation and answer');
    const confirm = await scenarioState.recoveryEnvelope(
      'customerMaterialConfirmV1',
      objectRef(
        'zhiju.project.customer_material',
        definedValue(scenarioState.candidateMaterial).objectId,
        scenarioState.scope(),
      ) as Common.ObjectRef,
      {
        candidateVersionRef: scenarioState.candidateMaterial,
        completeness: 'COMPLETE',
        declaredStatus: 'approved',
        evidenceRefs: [{ evidence: scenarioState.recoverySource, relation: 'SUPPORTS' }],
        justification: {
          reasonCode: 'HUMAN_REVIEW',
          summary: 'Human confirms the exact candidate and source.',
          evidenceRefs: [{ evidence: scenarioState.recoverySource, relation: 'SUPPORTS' }],
        },
      } as unknown as CanonicalJsonObject,
      scenarioState.operator(),
      1,
    );
    const confirmed = await scenarioState.recoveryEntry.command(
      confirm,
      scenarioState.sessionFor(),
    );
    expect(confirmed).toMatchObject({ status: 'COMMITTED' });
    const confirmationDecision = definedValue(
      (
        await scenarioState.admin.query<{ canonical_payload: CanonicalJsonObject }>(
          'SELECT canonical_payload FROM identity_policy.authorization_decision WHERE authorization_decision_id=$1',
          [record(confirm.authorizationDecisionRef).objectId],
        )
      ).rows[0],
    ).canonical_payload;
    const confirmationIssuedAt = confirmationDecision.requestedAt;
    expect(confirmationIssuedAt).toBe(confirm.requestedAt);
    if (typeof confirmationIssuedAt !== 'string')
      throw new Error('missing owning confirmation issuance time');
    const confirmedRef = record(scenarioState.committedPayload(confirmed)).customerMaterialRef;
    const discoverPayload = {
        commandId: String(confirm.commandId),
        scopeRef: scenarioState.scope(),
      },
      discoverTarget = objectRef(
        'zhiju.project.command_receipt',
        String(confirm.commandId),
        scenarioState.scope(),
      ) as Common.ObjectRef;
    const discovery = await scenarioState.recoveryAuth.authorize(
      scenarioState.identityDeps([scenarioState.fixture.projectId]),
      'confirmationReceiptDiscoverV1',
      {
        actorSnapshotRef: scenarioState.operator().actorRef,
        commandType: 'project.confirmation_receipt.discover',
        commandVersion: '1.0',
        commandPayloadHash: digestCanonicalPayload(discoverPayload).hash,
        authenticationContextHash: AUTH_HASH,
        targetRef: discoverTarget,
      },
    );
    if (discovery.outcome !== 'ALLOW') throw new Error('discovery denied');
    const receipt = (
      await scenarioState.recoveryEntry.discoverReceipt(
        String(confirm.commandId),
        scenarioState.sessionFor(),
        discovery.authorizationDecisionRef,
        scenarioState.scope(),
      )
    ).commandReceiptRef;
    scenarioState.clock = Math.max(scenarioState.clock, Date.now());
    const answer = {
      answerId: newUuidV7(),
      responder: objectRef('zhiju.identity.principal', OPERATOR, scenarioState.scope()),
      answerContent: {
        candidateMaterialRef: scenarioState.candidateMaterial,
        confirmedMaterialRef: confirmedRef,
      },
      sourceRefs: [scenarioState.recoverySource],
      submittedAt: new Date(scenarioState.clock).toISOString(),
    };
    let answerPayload = {
      answer: {
        ...answer,
        payloadHash: contentHash(sha256CanonicalJson(answer as unknown as CanonicalJsonObject)),
      },
    } as unknown as CanonicalJsonObject;
    let answerEnv = await scenarioState.recoveryEnvelope(
      'informationAnswerSubmitV1',
      requestRef,
      answerPayload,
      scenarioState.operator(),
      1,
    );
    const denialSnapshot = async () =>
      (
        await scenarioState.admin.query<{
          status: string;
          aggregate_version: string;
          accepted_answer_ref: unknown;
          resolution_ref: unknown;
        }>(
          `SELECT status,aggregate_version,accepted_answer_ref,resolution_ref FROM task_execution.information_request WHERE request_id=$1`,
          [requestRef.objectId],
        )
      ).rows;
    const openBefore = await denialSnapshot();
    if (scenarioState.exerciseRecoveryFaultMatrix) {
      for (const change of [
        { responder: objectRef('zhiju.identity.principal', newUuidV7(), scenarioState.scope()) },
        { sourceRefs: [] },
        {
          answerContent: {
            candidateMaterialRef: {
              ...record(scenarioState.candidateMaterial),
              versionId: newUuidV7(),
            },
            confirmedMaterialRef: confirmedRef,
          },
        },
        { submittedAt: new Date(scenarioState.clock + 1).toISOString() },
      ]) {
        const invalidAnswer = { ...answer, ...change };
        const payload = {
          answer: {
            ...invalidAnswer,
            payloadHash: contentHash(
              sha256CanonicalJson(invalidAnswer as unknown as CanonicalJsonObject),
            ),
          },
        } as unknown as CanonicalJsonObject;
        const envelope = await scenarioState.recoveryEnvelope(
          'informationAnswerSubmitV1',
          requestRef,
          payload,
          scenarioState.operator(),
          1,
        );
        await expect(
          scenarioState.recoveryEntryRaw.command(envelope, scenarioState.sessionFor()),
          'TE-REC-D-005 invalid answer',
        ).rejects.toBeDefined();
        expect(await denialSnapshot()).toEqual(openBefore);
        expect(await scenarioState.receiptRows(String(envelope.idempotencyKey))).toEqual([]);
      }
      scenarioState.queryReads.length = 0;
      await expect(
        createBlockedInputRecoveryEntry({
          ...scenarioState.recoveryConfig,
          taskExecutionDb: scenarioState.guardedTeDb,
          recoveryCapabilityCodes: {
            ...scenarioState.recoveryCodes,
            informationAnswerSubmitV1: 'wi231.missing',
          },
        }).command(answerEnv, scenarioState.sessionFor()),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
      expect(scenarioState.protectedReads()).toEqual([]);
      await expect(
        scenarioState.recoveryEntryRaw.command(
          answerEnv,
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).rejects.toBeDefined();
      expect(await denialSnapshot()).toEqual(openBefore);
      for (const borrower of scenarioState.borrowedActors) {
        scenarioState.queryReads.length = 0;
        await expect(
          scenarioState.recoveryEntryRaw.command(
            { ...answerEnv, actor: borrower.actorRef },
            scenarioState.sessionFor(borrower),
          ),
        ).rejects.toBeDefined();
        expect(scenarioState.protectedReads()).toEqual([]);
        expect(await denialSnapshot()).toEqual(openBefore);
        expect(await scenarioState.receiptRows(String(answerEnv.idempotencyKey))).toEqual([]);
      }
    }
    if (scenarioState.exerciseRecoveryFaultMatrix) {
      const agent = definedValue(
        scenarioState.borrowedActors.find((actor) => actor.principalKind === 'AGENT'),
      );
      expect(
        await scenarioState.recoveryAuth.authorize(
          scenarioState.identityDeps([scenarioState.fixture.projectId], agent),
          'informationAnswerSubmitV1',
          {
            actorSnapshotRef: agent.actorRef,
            commandType: 'execution.submit_information_answer',
            commandVersion: '1.0',
            commandPayloadHash: digestCanonicalPayload(answerPayload).hash,
            authenticationContextHash: agent.authHash,
            targetRef: requestRef,
          },
        ),
      ).toMatchObject({ outcome: 'DENY' });
      const actingHuman = definedValue(
        scenarioState.borrowedActors.find((actor) => actor.principalKind === 'HUMAN'),
      );
      const actingAnswer = await scenarioState.recoveryEnvelope(
        'informationAnswerSubmitV1',
        requestRef,
        answerPayload,
        actingHuman,
        1,
      );
      await expect(
        scenarioState.recoveryEntryRaw.command(actingAnswer, scenarioState.sessionFor(actingHuman)),
      ).rejects.toBeDefined();
      expect(await denialSnapshot()).toEqual(openBefore);
      expect(await scenarioState.receiptRows(String(actingAnswer.idempotencyKey))).toEqual([]);
    }
    if (scenarioState.exerciseRecoveryFaultMatrix)
      for (const change of ['GRANT', 'REQUEST_EXPIRY'] as const) {
        const locked = await scenarioState.recoveryEnvelope(
          'informationAnswerSubmitV1',
          requestRef,
          answerPayload,
          scenarioState.operator(),
          1,
        );
        const blocker = new pg.Client({ connectionString: scenarioState.activeDatabaseUrl });
        await blocker.connect();
        const savedClock = scenarioState.clock;
        let pending: Promise<unknown> | undefined;
        try {
          await blocker.query('BEGIN');
          const blockerPid = definedValue(
            (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0],
          ).pid;
          await blocker.query(
            'SELECT request_id FROM task_execution.information_request WHERE request_id=$1 FOR UPDATE',
            [requestRef.objectId],
          );
          pending = scenarioState.recoveryEntryRaw.command(locked, scenarioState.sessionFor());
          void pending.catch(() => undefined);
          const until = Date.now() + 10_000;
          let waiting = false;
          while (Date.now() < until) {
            waiting =
              (
                await scenarioState.admin.query(
                  'SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',
                  [blockerPid],
                )
              ).rows.length > 0;
            if (waiting) break;
            await new Promise<void>((resolve) => setTimeout(resolve, 20));
          }
          expect(waiting, 'actual Answer transaction waits for the Request row lock').toBe(true);
          if (change === 'GRANT') {
            const grantId = definedValue(
              scenarioState.recoveryGrants.get(
                `${OPERATOR}:informationAnswerSubmitV1:execution.information_request`,
              ),
            );
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
                  reasonCode: 'WI231_LOCKED_ANSWER_REVOKE',
                  effectiveAt: new Date(scenarioState.clock),
                  idempotencyKey: newUuidV7(),
                },
              ),
            ).toMatchObject({ status: 'COMMITTED' });
          } else scenarioState.clock = new Date(definition.expiresAt).getTime() + 1;
          await blocker.query('COMMIT');
          await expect(pending).rejects.toBeDefined();
          expect(await denialSnapshot()).toEqual(openBefore);
          expect(await scenarioState.receiptRows(String(locked.idempotencyKey))).toEqual([]);
        } finally {
          await blocker.query('ROLLBACK');
          await Promise.allSettled(pending ? [pending] : []);
          await blocker.end();
          scenarioState.clock = Math.max(savedClock, Date.now());
          if (change === 'GRANT') {
            const binding = definedValue(
              BLOCKED_INPUT_RECOVERY_BINDINGS.find(
                (entry) => entry.capabilityConfigKey === 'informationAnswerSubmitV1',
              ),
            );
            const restored = await scenarioState.grant({
              principal: scenarioState.operator(),
              capabilityCode: definedValue(scenarioState.recoveryCodes.informationAnswerSubmitV1),
              action: binding.requiredGrantAction,
              actions: [binding.requiredGrantAction, 'execution.information_request.resolve.v1'],
              selectorType: binding.selectorType,
              targetObjectType: 'execution.information_request',
            });
            scenarioState.recoveryGrants.set(
              `${OPERATOR}:informationAnswerSubmitV1:execution.information_request`,
              restored,
            );
            scenarioState.recoveryGrants.set(
              `${OPERATOR}:informationRequestResolveV1:execution.information_request`,
              restored,
            );
          }
        }
      }
    if (scenarioState.exerciseRecoveryFaultMatrix) {
      answer.submittedAt = new Date(scenarioState.clock).toISOString();
      answerPayload = {
        answer: {
          ...answer,
          payloadHash: contentHash(sha256CanonicalJson(answer as unknown as CanonicalJsonObject)),
        },
      } as unknown as CanonicalJsonObject;
      answerEnv = await scenarioState.recoveryEnvelope(
        'informationAnswerSubmitV1',
        requestRef,
        answerPayload,
        scenarioState.operator(),
        1,
      );
    }
    if (scenarioState.exerciseRecoveryFaultMatrix)
      await scenarioState.recoveryReceiptRollback(answerEnv, () =>
        scenarioState.recoveryEntryRaw.command(answerEnv, scenarioState.sessionFor()),
      );
    let answered: CommandResult;
    if (scenarioState.exerciseRecoveryFaultMatrix) {
      const concurrentAnswer = await scenarioState.recoveryEnvelope(
        'informationAnswerSubmitV1',
        requestRef,
        answerPayload,
        scenarioState.operator(),
        1,
      );
      const [winner, answerWinner] = await Promise.all([
        scenarioState.recoveryEntry.command(answerEnv, scenarioState.sessionFor()),
        scenarioState.recoveryEntryRaw.command(concurrentAnswer, scenarioState.sessionFor()),
      ]);
      expect(answerWinner).toMatchObject({
        status: 'COMMITTED',
        resultPayload: scenarioState.committedPayload(winner),
      });
      answered = winner;
      const conflictingAnswer = { ...answer, answerId: newUuidV7() };
      await rejectRecovery(
        'informationAnswerSubmitV1',
        requestRef,
        {
          answer: {
            ...conflictingAnswer,
            payloadHash: contentHash(
              sha256CanonicalJson(conflictingAnswer as unknown as CanonicalJsonObject),
            ),
          },
        } as unknown as CanonicalJsonObject,
        scenarioState.operator(),
        2,
      );

      expect(
        await scenarioState.recoveryEntry.command(answerEnv, scenarioState.sessionFor()),
      ).toMatchObject({
        status: 'DUPLICATE',
      });
    } else
      answered = await scenarioState.recoveryEntry.command(answerEnv, scenarioState.sessionFor());
    expect(answered).toMatchObject({ status: 'COMMITTED' });
    expect(await requestQuery()).toMatchObject({ status: 'ANSWERED', aggregateVersion: 2 });
    scenarioState.clock = Math.max(scenarioState.clock, Date.now());
    scenarioState.phase('bounded recovery: resolution and refusal matrix');
    const resolvePayload = {
      acceptedAnswerRef: record(scenarioState.committedPayload(answered)).answerRef,
      domainCommandRefs: [receipt],
      resolutionDisposition: 'execution.resolution.customer_material_confirmed',
      resolvedBy: objectRef('zhiju.identity.principal', OPERATOR, scenarioState.scope()),
      resolvedAt: new Date(scenarioState.clock).toISOString(),
      justification: {
        reasonCode: 'HUMAN_REVIEW',
        summary: 'Human confirms the exact material and committed confirmation receipt.',
        evidenceRefs: [receipt],
      },
    } as unknown as CanonicalJsonObject;
    const resolve = await scenarioState.recoveryEnvelope(
      'informationRequestResolveV1',
      requestRef,
      resolvePayload,
      scenarioState.operator(),
      2,
    );
    const answeredBefore = await denialSnapshot();
    if (scenarioState.exerciseRecoveryFaultMatrix) {
      const secondPropose = await scenarioState.recoveryEnvelope(
        'customerMaterialProposeV1',
        objectRef(
          'zhiju.project.customer_material',
          newUuidV7(),
          scenarioState.scope(),
        ) as Common.ObjectRef,
        record(definedValue(scenarioState.recoveryProposeEnvelope).payload) as CanonicalJsonObject,
        scenarioState.operator(),
      );
      const proposedOther = await scenarioState.recoveryEntryRaw.command(
        secondPropose,
        scenarioState.sessionFor(),
      );
      const otherCandidate = record(
        scenarioState.committedPayload(proposedOther),
      ).customerMaterialRef;
      const secondConfirm = await scenarioState.recoveryEnvelope(
        'customerMaterialConfirmV1',
        secondPropose.targetRef as Common.ObjectRef,
        {
          ...record(confirm.payload),
          candidateVersionRef: otherCandidate,
        } as CanonicalJsonObject,
        scenarioState.operator(),
        1,
      );
      secondConfirm.correlationId = confirm.correlationId;
      expect(
        await scenarioState.recoveryEntryRaw.command(secondConfirm, scenarioState.sessionFor()),
      ).toMatchObject({
        status: 'COMMITTED',
      });
      const discoverOther = async (commandId: string) => {
        const payload = { commandId, scopeRef: scenarioState.scope() };
        const signed = await scenarioState.recoveryAuth.authorize(
          scenarioState.identityDeps([scenarioState.fixture.projectId]),
          'confirmationReceiptDiscoverV1',
          {
            actorSnapshotRef: scenarioState.operator().actorRef,
            commandType: 'project.confirmation_receipt.discover',
            commandVersion: '1.0',
            commandPayloadHash: digestCanonicalPayload(payload).hash,
            authenticationContextHash: AUTH_HASH,
            targetRef: objectRef(
              'zhiju.project.command_receipt',
              commandId,
              scenarioState.scope(),
            ) as Common.ObjectRef,
          },
        );
        if (signed.outcome !== 'ALLOW') throw new Error('receipt discovery denied');
        return scenarioState.recoveryEntryRaw.discoverReceipt(
          commandId,
          scenarioState.sessionFor(),
          signed.authorizationDecisionRef,
          scenarioState.scope(),
        );
      };
      const otherReceipt = (await discoverOther(String(secondConfirm.commandId))).commandReceiptRef;
      const unrelated = await scenarioState.recoveryEnvelope(
        'informationRequestResolveV1',
        requestRef,
        {
          ...resolvePayload,
          domainCommandRefs: [otherReceipt],
        } as unknown as CanonicalJsonObject,
        scenarioState.operator(),
        2,
      );
      await expect(
        scenarioState.recoveryEntryRaw.command(unrelated, scenarioState.sessionFor()),
      ).rejects.toMatchObject({
        code: 'EXECUTION_RESOLUTION_RECEIPT_INVALID',
      });
      expect(await denialSnapshot()).toEqual(answeredBefore);
      expect(await scenarioState.receiptRows(String(unrelated.idempotencyKey))).toEqual([]);
      await expect(discoverOther(newUuidV7())).rejects.toBeDefined();
      await expect(
        scenarioState.recoveryEntryRaw.discoverReceipt(
          String(confirm.commandId),
          scenarioState.sessionFor(scenarioState.other()),
          discovery.authorizationDecisionRef,
          scenarioState.scope(),
        ),
      ).rejects.toBeDefined();
      await expect(
        scenarioState.recoveryEntryRaw.discoverReceipt(
          String(confirm.commandId),
          scenarioState.sessionFor(),
          discovery.authorizationDecisionRef,
          { enterpriseId: scenarioState.fixture.enterpriseId, projectId: newUuidV7() },
        ),
      ).rejects.toBeDefined();
      await expect(
        createBlockedInputRecoveryEntry({
          ...scenarioState.recoveryConfig,
          recoveryCapabilityCodes: {
            ...scenarioState.recoveryCodes,
            confirmationReceiptDiscoverV1: 'wi231.no.discovery.grant',
          },
        }).discoverReceipt(
          String(confirm.commandId),
          scenarioState.sessionFor(),
          discovery.authorizationDecisionRef,
          scenarioState.scope(),
        ),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
    }

    if (scenarioState.exerciseRecoveryFaultMatrix) {
      for (const change of [
        {
          domainCommandRefs: [
            {
              ...record(receipt),
              contentHash: contentHash(sha256CanonicalJson({ forged: true })),
            },
          ],
        },
        { domainCommandRefs: [{ ...record(receipt), objectId: newUuidV7() }] },
        {
          domainCommandRefs: [
            {
              ...record(receipt),
              scope: { enterpriseId: scenarioState.fixture.enterpriseId, projectId: newUuidV7() },
            },
          ],
        },
        {
          acceptedAnswerRef: {
            ...record(resolvePayload.acceptedAnswerRef),
            objectId: newUuidV7(),
          },
        },
        { resolvedBy: objectRef('zhiju.identity.principal', newUuidV7(), scenarioState.scope()) },
        { resolvedAt: new Date(scenarioState.clock + 1).toISOString() },
      ]) {
        const envelope = await scenarioState.recoveryEnvelope(
          'informationRequestResolveV1',
          requestRef,
          { ...resolvePayload, ...change } as CanonicalJsonObject,
          scenarioState.operator(),
          2,
        );
        await expect(
          scenarioState.recoveryEntryRaw.command(envelope, scenarioState.sessionFor()),
          'TE-REC-D-004 forged or unrelated resolution',
        ).rejects.toBeDefined();
        expect(await denialSnapshot()).toEqual(answeredBefore);
        expect(await scenarioState.receiptRows(String(envelope.idempotencyKey))).toEqual([]);
      }
      await rejectRecovery(
        'workOrderRetryScheduleV1',
        scenarioState.workOrderRef,
        {
          previousRunRef: scenarioState.runRef,
          nextAttemptNumber: 2,
          retryReason: 'BLOCKED_INPUT_RESOLVED',
          retryPolicyRef: scenarioState.controlsRef,
        } as unknown as CanonicalJsonObject,
        scenarioState.operator(),
        await woVersion(),
      );
    }
    const resolved = await scenarioState.recoveryEntry.command(resolve, scenarioState.sessionFor());
    expect(resolved).toMatchObject({ status: 'COMMITTED' });
    const resolutionRef = record(scenarioState.committedPayload(resolved)).resolutionRef;
    expect(
      await scenarioState.recoveryEntry.command(resolve, scenarioState.sessionFor()),
    ).toMatchObject({
      status: 'DUPLICATE',
    });
    expect(await requestQuery()).toMatchObject({
      status: 'RESOLVED',
      aggregateVersion: 3,
      resolutionRef,
    });
    await scenarioState.boardProbe?.('REQUEST_RESOLVED', scenarioState.runRef);
    let historicalProof:
      | {
          input: RecoveryHumanEligibilityInput;
          authority: Parameters<typeof readRecoveryHumanEligibility>[2];
        }
      | undefined;
    if (await verifyRecoveryResolutionFaults(stageDependencies)) return true;
    scenarioState.clock = Math.max(scenarioState.clock, Date.now());
    scenarioState.phase('bounded recovery: Context-2 build and validation');
    const freshSlice = await scenarioState.captureSlice({
      principal: scenarioState.service,
      purpose: PURPOSE_DOCUMENT,
      capturePolicyRef: scenarioState.captureRef,
      idempotencyKey: newUuidV7(),
    });
    const firstBinding = definedValue(
      await scenarioState.contextSnapshotBuildRow(
        String(record(scenarioState.contextRef).snapshotId),
      ),
    );
    const buildRequest = {
      workOrderRef: scenarioState.workOrderRef,
      workOrderContractRef: scenarioState.read.contractRef,
      projectionType: record(
        record(
          definedValue(
            await scenarioState.contextSnapshotRow(
              String(record(scenarioState.contextRef).objectId),
            ),
          ).canonical_payload,
        ).projection,
      ).projectionType,
      purpose: record(firstBinding.canonical_payload).purpose,
      audience: objectRef(
        'zhiju.identity.principal',
        String(record(record(firstBinding.canonical_payload).audience).principalId),
        scenarioState.scope(),
      ),
      sourceSlices: [freshSlice],
      answeredInformationRefs: [resolutionRef],
      builderPolicyRef: record(firstBinding.canonical_payload).builderPolicyRef,
      ...(scenarioState.recoveryVariant === 'STALE_CONTEXT'
        ? { expiresAt: new Date(scenarioState.clock + 10_000).toISOString() }
        : scenarioState.recoveryVariant.startsWith('SECOND_')
          ? { expiresAt: new Date(scenarioState.clock + 60_000).toISOString() }
          : {}),
    };
    const buildEnv = await scenarioState.recoveryEnvelope(
      'frozenContextBuildV1_1',
      objectRef(
        'zhiju.execution.context_snapshot',
        newUuidV7(),
        scenarioState.scope(),
      ) as Common.ObjectRef,
      { request: buildRequest } as unknown as CanonicalJsonObject,
      scenarioState.service,
    );
    if (scenarioState.exerciseRecoveryFaultMatrix) {
      // The public request accepts ordinary TypedReference arrays. The finite
      // recovery profile rejects unsupported arrays at the owning Handler.
      for (const answeredInformationRefs of [
        [],
        [resolutionRef, resolutionRef],
        [record(scenarioState.committedPayload(answered)).answerRef],
        [scenarioState.workOrderRef],
      ]) {
        const target = objectRef(
          'zhiju.execution.context_snapshot',
          newUuidV7(),
          scenarioState.scope(),
        ) as Common.ObjectRef;
        const envelope = await scenarioState.recoveryEnvelope(
          'frozenContextBuildV1_1',
          target,
          {
            request: { ...buildRequest, answeredInformationRefs },
          } as unknown as CanonicalJsonObject,
          scenarioState.service,
        );
        expect(
          scenarioState.registry.validateOperation(
            'execution.build_context_snapshot',
            '1.1',
            envelope,
          ),
        ).toEqual({
          valid: true,
          errors: [],
        });
        await expect(
          scenarioState.recoveryEntryRaw.command(
            envelope,
            scenarioState.sessionFor(scenarioState.service),
          ),
        ).rejects.toMatchObject({
          code: 'EXECUTION_INFORMATION_REQUEST_UNRESOLVED',
        });
        expect(await scenarioState.receiptRows(String(envelope.idempotencyKey))).toEqual([]);
        expect(await scenarioState.contextSnapshotRow(target.objectId)).toBeUndefined();
      }
      for (const change of [
        { sourceSlices: [scenarioState.slice] },
        {
          workOrderContractRef: {
            ...record(scenarioState.read.contractRef),
            contentHash: contentHash('0'.repeat(64)),
          },
        },
        { purpose: 'execution.other_purpose' },
        { audience: objectRef('zhiju.identity.principal', OPERATOR, scenarioState.scope()) },
      ])
        await rejectRecovery(
          'frozenContextBuildV1_1',
          objectRef(
            'zhiju.execution.context_snapshot',
            newUuidV7(),
            scenarioState.scope(),
          ) as Common.ObjectRef,
          { request: { ...buildRequest, ...change } } as unknown as CanonicalJsonObject,
        );
    }
    if (
      ['REQUEST_EXPIRED', 'CONTROLS_SUPERSEDED', 'BUILDER_SUPERSEDED'].includes(
        scenarioState.recoveryVariant,
      )
    ) {
      if (scenarioState.recoveryVariant === 'REQUEST_EXPIRED') {
        scenarioState.clock = new Date(definition.expiresAt).getTime() + 1;
      } else {
        scenarioState.clock = Math.max(scenarioState.clock, Date.now());
        const builder = scenarioState.recoveryVariant === 'BUILDER_SUPERSEDED';
        const oldRef = builder ? scenarioState.recoveryBuilderRef : scenarioState.controlsRef;
        const originalPolicy = definedValue(
          (
            await scenarioState.admin.query<{ policy_document: CanonicalJsonObject }>(
              "SELECT canonical_payload->'policyDocument' AS policy_document FROM identity_policy.policy_version WHERE policy_object_id=$1 AND policy_key_version_id=$2",
              [oldRef.objectId, oldRef.versionId],
            )
          ).rows[0],
        );
        await scenarioState.registerPolicyVersionAs({
          key: { ...oldRef, versionId: newUuidV7() },
          factId: newUuidV7(),
          idempotencyKey: newUuidV7(),
          effectiveFrom: new Date(scenarioState.clock),
          supersedesRef: oldRef,
          policySchemaRefs: [
            profileReference(
              builder ? BUILDER_PROFILE : 'execution.work_order_controls.policy@1.1',
            ),
          ],
          policyDocument: originalPolicy.policy_document,
        });
      }
      scenarioState.processPending = buildEnv as CanonicalJsonObject;
      scenarioState.processExecute = (command) =>
        scenarioState.recoveryEntryRaw.command(
          command,
          scenarioState.sessionFor(scenarioState.service),
        );
      if (scenarioState.recoveryVariant === 'REQUEST_EXPIRED') {
        // Renew only the worker's independent scan/progress authority. The saved business
        // inputs and the expired Request remain unchanged.
        for (const worker of definedValue(scenarioState.processWorkers)) await worker.stop();
        scenarioState.processWorkers = undefined;
        scenarioState.processAuthorities.length = 0;
        expect(
          await scenarioState.throughRecoveryProcess(buildEnv, scenarioState.processExecute),
        ).toBeUndefined();
      } else for (const worker of definedValue(scenarioState.processWorkers)) await worker.tick();
      const authority = definedValue(scenarioState.processAuthorities[0]);
      expect(
        await readBlockedInputRecoveryProgress(
          scenarioState.teDb,
          authority.progressContext,
          authority.revalidateProgress,
        ),
      ).toContainEqual(
        expect.objectContaining({
          process_id: blockedInputRecoveryProcessId(
            scenarioState.resultRef as unknown as CanonicalJsonObject,
            scenarioState.proposalId,
          ),
          state: 'SUSPENDED',
          recovery_step: 3,
          blocked_reason_code:
            scenarioState.recoveryVariant === 'REQUEST_EXPIRED'
              ? 'EXECUTION_CONTEXT_SOURCE_INVALID'
              : 'POLICY_EXPIRED',
        }),
      );
      expect(
        await scenarioState.contextSnapshotRow(String(record(buildEnv.targetRef).objectId)),
      ).toBeUndefined();
      expect(await scenarioState.receiptRows(String(buildEnv.idempotencyKey))).toEqual([]);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT attempt_number FROM task_execution.run WHERE work_order_id=$1',
            [scenarioState.woId],
          )
        ).rows,
      ).toEqual([{ attempt_number: 1 }]);
      expect(scenarioState.runtimeDriver.invokedAttemptIds).toEqual([
        scenarioState.attemptRef.objectId,
      ]);
      for (const worker of definedValue(scenarioState.processWorkers)) await worker.stop();
      return true;
    }
    if (scenarioState.recoveryVariant === 'SUSPEND') {
      const buildGrant = definedValue(
        scenarioState.recoveryGrants.get(
          `${scenarioState.serviceId}:frozenContextBuildV1_1:zhiju.execution.context_snapshot`,
        ),
      );
      expect(
        await scenarioState.revokeCapabilityTracked(
          scenarioState.identityDeps([scenarioState.fixture.projectId]),
          {
            targetId: buildGrant,
            expectedAggregateVersion: '1',
            scope: {
              scopeKind: 'PROJECT',
              enterpriseId: scenarioState.fixture.enterpriseId,
              projectId: scenarioState.fixture.projectId,
            },
            reasonCode: 'WI231_SUSPEND_BUILD',
            effectiveAt: new Date(scenarioState.clock),
            idempotencyKey: newUuidV7(),
          },
        ),
      ).toMatchObject({ status: 'COMMITTED' });
      scenarioState.processPending = buildEnv as CanonicalJsonObject;
      scenarioState.processExecute = (command) =>
        scenarioState.recoveryEntryRaw.command(
          command,
          scenarioState.sessionFor(scenarioState.service),
        );
      await definedValue(definedValue(scenarioState.processWorkers)[0]).tick();
      await definedValue(definedValue(scenarioState.processWorkers)[1]).tick();
      const authority = definedValue(scenarioState.processAuthorities[0]);
      expect(
        await readBlockedInputRecoveryProgress(
          scenarioState.teDb,
          authority.progressContext,
          authority.revalidateProgress,
        ),
      ).toContainEqual(
        expect.objectContaining({
          process_id: blockedInputRecoveryProcessId(
            scenarioState.resultRef as unknown as CanonicalJsonObject,
            scenarioState.proposalId,
          ),
          state: 'SUSPENDED',
          recovery_step: 3,
          blocked_reason_code: 'AUTHORIZATION_REVOKED',
        }),
      );
      expect(
        await scenarioState.contextSnapshotRow(String(record(buildEnv.targetRef).objectId)),
      ).toBeUndefined();
      expect(
        (
          await scenarioState.admin.query(
            'SELECT attempt_number FROM task_execution.run WHERE work_order_id=$1',
            [scenarioState.woId],
          )
        ).rows,
      ).toEqual([{ attempt_number: 1 }]);
      expect(scenarioState.runtimeDriver.invokedAttemptIds).toEqual([
        scenarioState.attemptRef.objectId,
      ]);
      for (const worker of definedValue(scenarioState.processWorkers)) await worker.stop();
      return true;
    }
    const built = await scenarioState.recoveryEntry.command(
      buildEnv,
      scenarioState.sessionFor(scenarioState.service),
    );
    expect(built).toMatchObject({ status: 'COMMITTED' });
    const context2 = record(scenarioState.committedPayload(built)).contextSnapshotRef;
    const context2Row = definedValue(
      await scenarioState.contextSnapshotRow(String(record(context2).objectId)),
    );
    const context2Read = await scenarioState.attemptRead(
      await scenarioState.preparedRead({ snapshotRef: context2 as Common.SnapshotRef }),
    );
    expect(context2Read).toMatchObject({ code: 'COMMITTED', thrown: false });
    if (context2Read.result?.status !== 'COMMITTED')
      throw new Error('Context-2 read did not commit');
    expect(record(context2Read.result.resultPayload).projectContextContract).toEqual(
      context2Row.canonical_payload,
    );
    expect(
      (context2Row.canonical_payload.contextItems as CanonicalJsonObject[]).filter(
        (item) => item.kind === 'MATERIAL',
      ),
    ).toMatchObject([
      {
        subjectRef: confirmedRef,
        value: {
          presence: 'PRESENT',
          value: {
            candidateMaterialRef: scenarioState.candidateMaterial,
            confirmedMaterialRef: confirmedRef,
          },
        },
        epistemicState: 'CONFIRMED',
      },
    ]);

    expect(context2).not.toEqual(scenarioState.contextRef);
    expect(
      await scenarioState.recoveryEntry.command(
        buildEnv,
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({
      status: 'DUPLICATE',
    });
    // An actual worker reads current state and waits; it cannot schedule for the Human.
    scenarioState.processPending = (await scenarioState.recoveryEnvelope(
      'workOrderExecutionStateReadV1',
      scenarioState.workOrderRef,
      { workOrderRef: scenarioState.workOrderRef } as unknown as CanonicalJsonObject,
      scenarioState.service,
      undefined,
      true,
    )) as CanonicalJsonObject;
    scenarioState.processExecute = (command) =>
      scenarioState.recoveryEntryRaw.read(command, scenarioState.sessionFor(scenarioState.service));
    scenarioState.processResult = undefined;
    await definedValue(definedValue(scenarioState.processWorkers)[0]).tick();
    if (scenarioState.recoveryVariant === 'BUDGET_EXHAUSTED') {
      expect(scenarioState.processResult).toMatchObject({ retryEligibility: 'EXHAUSTED' });
      const authority = definedValue(scenarioState.processAuthorities[0]);
      expect(
        await readBlockedInputRecoveryProgress(
          scenarioState.teDb,
          authority.progressContext,
          authority.revalidateProgress,
        ),
      ).toContainEqual(
        expect.objectContaining({
          process_id: blockedInputRecoveryProcessId(
            scenarioState.resultRef as unknown as CanonicalJsonObject,
            scenarioState.proposalId,
          ),
          state: 'SUSPENDED',
          recovery_step: 4,
          blocked_reason_code: 'EXECUTION_WORK_ORDER_BUDGET_EXHAUSTED',
        }),
      );
      const refused = await scenarioState.recoveryEnvelope(
        'workOrderRetryScheduleV1',
        scenarioState.workOrderRef,
        {
          previousRunRef: scenarioState.runRef,
          nextAttemptNumber: 2,
          retryReason: 'BLOCKED_INPUT_RESOLVED',
          retryPolicyRef: scenarioState.controlsRef,
        } as unknown as CanonicalJsonObject,
        scenarioState.operator(),
        await woVersion(),
      );
      await expect(
        scenarioState.recoveryEntryRaw.command(refused, scenarioState.sessionFor()),
      ).rejects.toMatchObject({
        code: 'EXECUTION_WORK_ORDER_BUDGET_EXHAUSTED',
      });
      expect(await scenarioState.receiptRows(String(refused.idempotencyKey))).toEqual([]);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT intent_id FROM task_execution.work_order_retry_intent WHERE work_order_id=$1',
            [scenarioState.woId],
          )
        ).rows,
      ).toEqual([]);
      for (const worker of definedValue(scenarioState.processWorkers)) await worker.stop();
      return true;
    }
    expect(scenarioState.processResult).toMatchObject({
      status: 'WAITING_INPUT',
      retryEligibility: 'READY_TO_SCHEDULE',
    });
    expect(
      (
        await scenarioState.admin.query(
          "SELECT recovery_step,state FROM task_execution.process_instance WHERE process_type='blocked-input-recovery@1' AND process_id=$1",
          [
            blockedInputRecoveryProcessId(
              scenarioState.resultRef as unknown as CanonicalJsonObject,
              scenarioState.proposalId,
            ),
          ],
        )
      ).rows,
    ).toEqual([{ recovery_step: 4, state: 'ACTIVE' }]);
    expect(
      (
        await scenarioState.admin.query(
          'SELECT intent_id FROM task_execution.work_order_retry_intent WHERE work_order_id=$1',
          [scenarioState.woId],
        )
      ).rows,
    ).toEqual([]);
    scenarioState.processPending = undefined;
    const schedule = await scenarioState.recoveryEnvelope(
      'workOrderRetryScheduleV1',
      scenarioState.workOrderRef,
      {
        previousRunRef: scenarioState.runRef,
        nextAttemptNumber: 2,
        retryReason: 'BLOCKED_INPUT_RESOLVED',
        retryPolicyRef: scenarioState.controlsRef,
      } as unknown as CanonicalJsonObject,
      scenarioState.operator(),
      await woVersion(),
    );
    expect(
      await scenarioState.recoveryEntry.command(schedule, scenarioState.sessionFor()),
    ).toMatchObject({
      status: 'COMMITTED',
    });
    if (scenarioState.exerciseRecoveryFaultMatrix) {
      expect(
        await scenarioState.recoveryEntry.command(schedule, scenarioState.sessionFor()),
      ).toMatchObject({
        status: 'DUPLICATE',
      });
      const scheduleAgain = await scenarioState.recoveryEnvelope(
        'workOrderRetryScheduleV1',
        scenarioState.workOrderRef,
        record(schedule.payload) as CanonicalJsonObject,
        scenarioState.operator(),
        await woVersion(),
      );
      expect(
        await scenarioState.recoveryEntryRaw.command(scheduleAgain, scenarioState.sessionFor()),
      ).toMatchObject({
        status: 'COMMITTED',
      });
      await rejectRecovery(
        'workOrderRetryScheduleV1',
        scenarioState.workOrderRef,
        { ...record(schedule.payload), nextAttemptNumber: 3 },
        scenarioState.operator(),
        await woVersion(),
      );
    }
    expect(
      (
        await scenarioState.admin.query(
          'SELECT next_attempt_number FROM task_execution.work_order_retry_intent WHERE work_order_id=$1',
          [scenarioState.woId],
        )
      ).rows,
    ).toEqual([{ next_attempt_number: 2 }]);

    scenarioState.faultFirstRunCommands = true;
    const run2 = objectRef('execution.run', newUuidV7(), scenarioState.scope()) as Common.ObjectRef;
    const bundle2Envelope = await scenarioState.firstRunEnvelope(
      'identity.issue_execution_capability_bundle',
      objectRef(
        'zhiju.identity.execution_capability_bundle',
        newUuidV7(),
        scenarioState.scope(),
      ) as Common.ObjectRef,
      {
        runRef: run2,
        workOrderRef: scenarioState.workOrderRef,
        workOrderContractRef: scenarioState.read.contractRef,
        contextSnapshotRef: context2,
        servicePrincipalRef: { principalKind: 'SERVICE', principalId: scenarioState.serviceId },
        requestedCapabilities: scenarioState.revised.allowedCapabilities,
      } as unknown as CanonicalJsonObject,
      scenarioState.service,
    );
    if (scenarioState.recoveryVariant === 'STALE_CONTEXT') {
      await scenarioState.throughRecoveryProcess(
        await scenarioState.recoveryEnvelope(
          'workOrderExecutionStateReadV1',
          scenarioState.workOrderRef,
          { workOrderRef: scenarioState.workOrderRef } as unknown as CanonicalJsonObject,
          scenarioState.service,
          undefined,
          true,
        ),
        (command) =>
          scenarioState.recoveryEntryRaw.read(
            command,
            scenarioState.sessionFor(scenarioState.service),
          ),
      );
      // A committed build Receipt remains history when the current Snapshot expires.
      // The saved Process command must keep its old bytes and cannot swap in a new Context.
      scenarioState.clock = definedValue(context2Row.effective_expires_at).getTime() + 1;
      const expiredBundleEnvelope = await scenarioState.firstRunEnvelope(
        'identity.issue_execution_capability_bundle',
        bundle2Envelope.targetRef,
        bundle2Envelope.payload,
        scenarioState.service,
      );
      scenarioState.processPending = expiredBundleEnvelope as unknown as CanonicalJsonObject;
      scenarioState.processExecute = (command) =>
        scenarioState.firstRunEntryRaw.issueBundle(
          command,
          scenarioState.sessionFor(scenarioState.service),
        );
      await definedValue(definedValue(scenarioState.processWorkers)[0]).tick();
      await definedValue(definedValue(scenarioState.processWorkers)[1]).tick();
      const processId = blockedInputRecoveryProcessId(
        scenarioState.resultRef as unknown as CanonicalJsonObject,
        scenarioState.proposalId,
      );
      const saved = await scenarioState.admin.query<{ command_bytes: CanonicalJsonObject }>(
        'SELECT command_bytes FROM task_execution.recovery_process_command WHERE process_id=$1 AND step_no=5',
        [processId],
      );
      const originalCommand = structuredClone(definedValue(saved.rows[0]).command_bytes);
      expect(originalCommand.payload).toMatchObject({ contextSnapshotRef: context2 });
      const authority = definedValue(scenarioState.processAuthorities[0]);
      expect(
        await readBlockedInputRecoveryProgress(
          scenarioState.teDb,
          authority.progressContext,
          authority.revalidateProgress,
        ),
      ).toContainEqual(
        expect.objectContaining({
          process_id: processId,
          state: 'SUSPENDED',
          recovery_step: 5,
          blocked_reason_code: 'EXECUTION_CONTEXT_SOURCE_INVALID',
        }),
      );
      expect(await scenarioState.receiptRows(String(expiredBundleEnvelope.idempotencyKey))).toEqual(
        [],
      );
      const replacementSlice = await scenarioState.captureSlice({
        principal: scenarioState.service,
        purpose: PURPOSE_DOCUMENT,
        capturePolicyRef: scenarioState.captureRef,
        idempotencyKey: newUuidV7(),
      });
      const replacementEnvelope = await scenarioState.recoveryEnvelope(
        'frozenContextBuildV1_1',
        objectRef(
          'zhiju.execution.context_snapshot',
          newUuidV7(),
          scenarioState.scope(),
        ) as Common.ObjectRef,
        {
          request: {
            ...buildRequest,
            expiresAt: new Date(scenarioState.clock + 30_000).toISOString(),
            sourceSlices: [replacementSlice],
          },
        } as unknown as CanonicalJsonObject,
        scenarioState.service,
      );
      const replacement = await scenarioState.recoveryEntryRaw.command(
        replacementEnvelope,
        scenarioState.sessionFor(scenarioState.service),
      );
      expect(replacement).toMatchObject({ status: 'COMMITTED' });
      const replacementRef = record(scenarioState.committedPayload(replacement)).contextSnapshotRef;
      expect(replacementRef).not.toEqual(context2);
      expect(replacementEnvelope.idempotencyKey).not.toEqual(buildEnv.idempotencyKey);
      expect(await scenarioState.contextSnapshotRow(String(record(context2).objectId))).toEqual(
        context2Row,
      );
      expect(
        (
          await scenarioState.admin.query(
            'SELECT command_bytes FROM task_execution.recovery_process_command WHERE process_id=$1 AND step_no=5',
            [processId],
          )
        ).rows,
      ).toEqual([{ command_bytes: originalCommand }]);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT attempt_number FROM task_execution.run WHERE work_order_id=$1',
            [scenarioState.woId],
          )
        ).rows,
      ).toEqual([{ attempt_number: 1 }]);
      expect(scenarioState.runtimeDriver.invokedAttemptIds).toEqual([
        scenarioState.attemptRef.objectId,
      ]);
      for (const worker of definedValue(scenarioState.processWorkers)) await worker.stop();
      return true;
    }
    const bundle2 = await scenarioState.firstRunEntry.issueBundle(
      bundle2Envelope,
      scenarioState.sessionFor(scenarioState.service),
    );
    expect(bundle2).toMatchObject({ status: 'COMMITTED' });
    const bundle2Ref = record(scenarioState.committedPayload(bundle2 as CommandResult)).bundleRef;
    const bundle2Row = definedValue(
      (
        await scenarioState.admin.query<{ valid_until: Date }>(
          'SELECT valid_until FROM identity_policy.execution_capability_bundle WHERE bundle_id=$1',
          [record(bundle2Ref).objectId],
        )
      ).rows[0],
    );
    let deadline2 = bundle2Row.valid_until.toISOString();
    let remainingRecoverySeconds: number | undefined;
    if (scenarioState.shortRecoveryBudget) {
      const consumed = definedValue(
        (
          await scenarioState.admin.query<{ total_seconds: number; consumed_seconds: number }>(
            'SELECT b.total_seconds,c.consumed_seconds FROM task_execution.run_budget_reservation b JOIN task_execution.run_budget_consumption c USING(run_id) WHERE b.run_id=$1',
            [scenarioState.runRef.objectId],
          )
        ).rows[0],
      );
      expect(consumed.total_seconds).toBe(30);
      remainingRecoverySeconds = consumed.total_seconds - consumed.consumed_seconds;
      expect(remainingRecoverySeconds).toBeGreaterThan(0);
      scenarioState.clock = Math.max(scenarioState.clock, Date.now());
      deadline2 = new Date(
        Math.min(Date.parse(deadline2), scenarioState.clock + remainingRecoverySeconds * 1000),
      ).toISOString();
    }
    const create2 = await scenarioState.firstRunEnvelope(
      'execution.create_run',
      run2,
      {
        creation: {
          workOrderRef: scenarioState.workOrderRef,
          workOrderContractRef: scenarioState.read.contractRef,
          contextSnapshotRef: context2,
          capabilityGrantRef: bundle2Ref,
          leasePolicyRef: scenarioState.controlsRef,
          attemptNumber: 2,
          runtimeBinding: scenarioState.runtimeBinding,
          executionDeadline: deadline2,
        },
      } as unknown as CanonicalJsonObject,
      scenarioState.service,
    );
    if (await verifySecondRunCreationFaults(stageDependencies)) return true;
    if (scenarioState.exerciseRecoveryFaultMatrix)
      for (const change of [
        { contextSnapshotRef: scenarioState.contextRef },
        { runtimeBinding: { ...scenarioState.runtimeBinding, modelId: 'synthetic.other' } },
        {
          runtimeBinding: {
            ...scenarioState.runtimeBinding,
            executionNodeRef: {
              system: 'synthetic',
              resourceType: 'runtime.node',
              externalId: 'unsupported-node',
              observedAt: new Date(scenarioState.clock).toISOString(),
            },
          },
        },
      ]) {
        const refused = await scenarioState.firstRunEnvelope(
          'execution.create_run',
          run2,
          {
            creation: { ...record(create2.payload.creation), ...change },
          } as unknown as CanonicalJsonObject,
          scenarioState.service,
        );
        expect(
          scenarioState.registry.validateOperation('execution.create_run', '1.0', refused).valid,
        ).toBe(true);
        await expect(
          scenarioState.firstRunEntryRaw.createRun(
            refused,
            scenarioState.sessionFor(scenarioState.service),
          ),
        ).rejects.toBeDefined();
        expect(await scenarioState.receiptRows(refused.idempotencyKey)).toEqual([]);
        expect(
          (
            await scenarioState.admin.query(
              'SELECT run_id FROM task_execution.run WHERE run_id=$1',
              [run2.objectId],
            )
          ).rows,
        ).toEqual([]);
      }
    scenarioState.phase(`Run-2 ${scenarioState.recoveryVariant}: create and dispatch`);
    scenarioState.progress('Run-2 deadline', `remainingMs=${Date.parse(deadline2) - Date.now()}`);
    const created2 = await scenarioState.firstRunEntry.createRun(
      create2,
      scenarioState.sessionFor(scenarioState.service),
    );
    expect(created2).toMatchObject({ status: 'COMMITTED' });
    if (remainingRecoverySeconds !== undefined) {
      expect(
        (
          await scenarioState.admin.query<{ reserved_seconds: number; total_seconds: number }>(
            'SELECT reserved_seconds,total_seconds FROM task_execution.run_budget_reservation WHERE run_id=$1',
            [run2.objectId],
          )
        ).rows,
      ).toEqual([{ reserved_seconds: remainingRecoverySeconds, total_seconds: 30 }]);
    }
    const created2Data = record(scenarioState.committedPayload(created2 as CommandResult));
    expect(created2Data.fencingToken).toBe(2);
    expect(
      await scenarioState.firstRunEntry.createRun(
        create2,
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({
      status: 'DUPLICATE',
    });
    const attempt2 = objectRef(
      'integration.runtime_attempt',
      newUuidV7(),
      scenarioState.scope(),
    ) as Common.ObjectRef;
    const dispatch2 = await scenarioState.firstRunEnvelope(
      'integration.request_runtime_dispatch',
      attempt2,
      {
        request: {
          workOrderRef: scenarioState.workOrderRef,
          runRef: run2,
          workOrderContractRef: scenarioState.read.contractRef,
          contextSnapshotRef: context2,
          capabilityGrantRef: bundle2Ref,
          runtimeBinding: scenarioState.runtimeBinding,
          stableIdempotencyKey: newUuidV7(),
          requestedAt: new Date(scenarioState.clock).toISOString(),
        },
      } as unknown as CanonicalJsonObject,
      scenarioState.service,
    );
    if (scenarioState.exerciseRecoveryFaultMatrix)
      for (const change of [
        { contextSnapshotRef: scenarioState.contextRef },
        { capabilityGrantRef: scenarioState.bundleRef },
        { runtimeBinding: { ...scenarioState.runtimeBinding, modelId: 'synthetic.other' } },
      ]) {
        const refused = await scenarioState.firstRunEnvelope(
          'integration.request_runtime_dispatch',
          attempt2,
          {
            request: { ...record(dispatch2.payload.request), ...change },
          } as unknown as CanonicalJsonObject,
          scenarioState.service,
        );
        await expect(
          scenarioState.firstRunEntryRaw.dispatch(
            refused,
            scenarioState.sessionFor(scenarioState.service),
          ),
        ).rejects.toBeDefined();
        expect(scenarioState.runtimeDriver.invokedAttemptIds).toEqual([
          scenarioState.attemptRef.objectId,
        ]);
      }
    expect(
      await scenarioState.firstRunEntry.dispatch(
        dispatch2,
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({
      status: 'SUCCEEDED',
    });
    scenarioState.phase(`Run-2 ${scenarioState.recoveryVariant}: binding and start`);
    scenarioState.progress('Run-2 deadline', `remainingMs=${Date.parse(deadline2) - Date.now()}`);
    const binding2 = await scenarioState.firstRunEntry.getRuntimeAttemptBinding(
      await scenarioState.firstRunQuery(
        'integration.get_runtime_attempt_binding',
        attempt2,
        { attemptRef: attempt2 } as unknown as CanonicalJsonObject,
        'runtimeAttemptBindingReadV1',
      ),
      scenarioState.sessionFor(scenarioState.service),
    );
    const start2 = await scenarioState.firstRunEnvelope(
      'execution.start_run',
      run2,
      {
        leaseId: created2Data.leaseId,
        fencingToken: 2,
        runtimeAttemptRef: attempt2,
        startedAt: new Date(scenarioState.clock).toISOString(),
      } as unknown as CanonicalJsonObject,
      scenarioState.service,
      1,
    );
    if (scenarioState.exerciseRecoveryFaultMatrix)
      for (const change of [{ fencingToken: 1 }, { runtimeAttemptRef: scenarioState.attemptRef }]) {
        const refused = await scenarioState.firstRunEnvelope(
          'execution.start_run',
          run2,
          { ...start2.payload, ...change } as unknown as CanonicalJsonObject,
          scenarioState.service,
          1,
        );
        await expect(
          scenarioState.firstRunEntryRaw.startRun(
            refused,
            scenarioState.sessionFor(scenarioState.service),
          ),
        ).rejects.toBeDefined();
        expect(await scenarioState.receiptRows(refused.idempotencyKey)).toEqual([]);
      }
    expect(
      await scenarioState.firstRunEntry.startRun(
        start2,
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({
      status: 'COMMITTED',
    });
    expect(await reconcileWo(run2)).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { status: 'RUNNING' },
    });
    expect(await reconcileTask(run2)).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { status: scenarioState.otherChildId ? 'WAITING_INPUT' : 'IN_PROGRESS' },
    });
    scenarioState.phase(`Run-2 ${scenarioState.recoveryVariant}: final observation and submission`);
    scenarioState.progress('Run-2 deadline', `remainingMs=${Date.parse(deadline2) - Date.now()}`);
    const finalQuery2 = await scenarioState.firstRunQuery(
      'integration.get_runtime_final_observation',
      attempt2,
      { attemptRef: attempt2 } as unknown as CanonicalJsonObject,
      'runtimeFinalReadV1',
    );
    if (scenarioState.recoveryVariant === 'SECOND_WRONG_SESSION') {
      await expect(
        scenarioState.firstRunEntryRaw.observeRuntimeFinal(
          finalQuery2,
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).rejects.toBeDefined();
      expect(
        (
          await scenarioState.admin.query(
            'SELECT observation_id FROM integration_gateway.runtime_final_observation WHERE attempt_id=$1',
            [attempt2.objectId],
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT result_id FROM task_execution.agent_result WHERE run_id=$1',
            [run2.objectId],
          )
        ).rows,
      ).toEqual([]);
      expect(scenarioState.runtimeDriver.invokedAttemptIds).toEqual([
        scenarioState.attemptRef.objectId,
        attempt2.objectId,
      ]);
      await scenarioState.waitForDeadline(
        Math.max(0, Date.parse(deadline2) - Date.now() + 100),
        'Run-2 bad session expiry',
      );
      scenarioState.clock = Date.now();
      const expire = await scenarioState.firstRunEnvelope(
        'execution.expire_run',
        run2,
        { reason: 'DEADLINE_EXCEEDED' },
        scenarioState.service,
        2,
      );
      expect(
        await scenarioState.firstRunEntryRaw.expireRun(
          expire,
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).toMatchObject({
        status: 'COMMITTED',
      });
      expect(
        (
          await scenarioState.admin.query(
            'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
            [run2.objectId],
          )
        ).rows,
      ).toEqual([{ status: 'EXPIRED' }]);
      for (const worker of definedValue(scenarioState.processWorkers)) await worker.stop();
      return true;
    }
    if (scenarioState.formal) await scenarioState.createAndReleaseFormalOutput(run2, attempt2);
    const final2 = await scenarioState.firstRunEntry.observeRuntimeFinal(
      finalQuery2,
      scenarioState.sessionFor(scenarioState.service),
    );
    if (final2 === undefined) throw new Error('Run-2 final absent');
    if (
      !['SECOND_BLOCKED', 'SECOND_PARTIAL', 'SECOND_FAILED'].includes(scenarioState.recoveryVariant)
    )
      expect(record(final2.agentResultContract).executionOutcome).toBe('COMPLETED');
    const result2Body = record(final2.agentResultContract) as unknown as CanonicalJsonObject,
      result2Target = objectRef(
        'execution.agent_result',
        String(record(final2.agentResultContract).agentResultId),
        scenarioState.scope(),
      ) as Common.ObjectRef;
    if (scenarioState.exerciseRecoveryFaultMatrix) {
      const lateRun1 = await scenarioState.firstRunEnvelope(
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
        scenarioState.firstRunEntryRaw.submitAgentResult(
          lateRun1,
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).rejects.toBeDefined();
      expect(await scenarioState.receiptRows(lateRun1.idempotencyKey)).toEqual([]);
    }
    if (
      ['SECOND_BLOCKED', 'SECOND_PARTIAL', 'SECOND_FAILED'].includes(scenarioState.recoveryVariant)
    ) {
      const unsupportedSecond = await scenarioState.firstRunEnvelope(
        'execution.submit_agent_result',
        result2Target,
        {
          agentResultContract: result2Body,
          runFencingToken: 2,
          runtimeSubmissionRef: final2.runtimeSubmissionRef,
        },
        scenarioState.service,
      );
      await expect(
        scenarioState.firstRunEntryRaw
          .submitAgentResult(unsupportedSecond, scenarioState.sessionFor(scenarioState.service))
          .catch((error: unknown) => {
            scenarioState.progress(
              'Run-2 submission refusal',
              error !== null && typeof error === 'object' && 'code' in error
                ? String(error.code)
                : 'no error code',
            );
            throw error;
          }),
      ).rejects.toMatchObject({ code: 'EXECUTION_CRITERION_UNSUPPORTED' });
      expect(await scenarioState.receiptRows(unsupportedSecond.idempotencyKey)).toEqual([]);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT result_id FROM task_execution.agent_result WHERE run_id=$1',
            [run2.objectId],
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT result_id FROM task_execution.run_final_submission_claim WHERE run_id=$1',
            [run2.objectId],
          )
        ).rows,
      ).toEqual([]);
      const third = await scenarioState.firstRunEnvelope(
        'execution.create_run',
        objectRef('execution.run', newUuidV7(), scenarioState.scope()) as Common.ObjectRef,
        { creation: { ...record(create2.payload.creation), attemptNumber: 3 } },
        scenarioState.service,
      );
      await expect(
        scenarioState.firstRunEntryRaw.createRun(
          third,
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).rejects.toBeDefined();
      expect(await scenarioState.receiptRows(third.idempotencyKey)).toEqual([]);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT attempt_number FROM task_execution.run WHERE work_order_id=$1 ORDER BY attempt_number',
            [scenarioState.woId],
          )
        ).rows,
      ).toEqual([{ attempt_number: 1 }, { attempt_number: 2 }]);
      expect(scenarioState.runtimeDriver.invokedAttemptIds).toEqual([
        scenarioState.attemptRef.objectId,
        attempt2.objectId,
      ]);
      // Close this test's actual unsupported invocation before the next Project scan.
      // Expiry is independent and does not accept its rejected Result.
      const expiryWait = Math.max(0, Date.parse(deadline2) - Date.now() + 100);
      if (expiryWait > 0)
        await scenarioState.waitForDeadline(expiryWait, 'Run-2 unsupported final cleanup');
      scenarioState.clock = Date.now();
      const expireUnsupported = await scenarioState.firstRunEnvelope(
        'execution.expire_run',
        run2,
        { reason: 'DEADLINE_EXCEEDED' },
        scenarioState.service,
        2,
      );
      expect(
        await scenarioState.firstRunEntryRaw.expireRun(
          expireUnsupported,
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).toMatchObject({ status: 'COMMITTED' });
      expect(
        (
          await scenarioState.admin.query(
            'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
            [run2.objectId],
          )
        ).rows,
      ).toEqual([{ status: 'EXPIRED' }]);
      for (const worker of definedValue(scenarioState.processWorkers)) await worker.stop();
      return true;
    }
    scenarioState.progress(
      'Run-2 submission deadline',
      `remainingMs=${Date.parse(deadline2) - Date.now()}`,
    );
    const submit2 = await scenarioState.firstRunEntry.submitAgentResult(
      await scenarioState.firstRunEnvelope(
        'execution.submit_agent_result',
        result2Target,
        {
          agentResultContract: result2Body,
          runFencingToken: 2,
          runtimeSubmissionRef: final2.runtimeSubmissionRef,
        },
        scenarioState.service,
      ),
      scenarioState.sessionFor(scenarioState.service),
    );
    expect(submit2).toMatchObject({ status: 'COMMITTED' });
    const result2Ref = record(
      scenarioState.committedPayload(submit2 as CommandResult),
    ).agentResultRef;
    expect(
      await scenarioState.firstRunEntry.recordRunResult(
        await scenarioState.firstRunEnvelope(
          'execution.record_run_result',
          run2,
          { agentResultRef: result2Ref } as unknown as CanonicalJsonObject,
          scenarioState.service,
          2,
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({ status: 'COMMITTED' });
    const validate2 = await scenarioState.firstRunEntry.validateAgentResult(
      await scenarioState.firstRunEnvelope(
        'execution.validate_agent_result',
        objectRef(
          'zhiju.execution.agent_result_validation_bundle',
          newUuidV7(),
          scenarioState.scope(),
        ) as Common.ObjectRef,
        {
          agentResultRef: result2Ref,
          runRef: run2,
          runtimeAttemptRef: attempt2,
          policyRef: scenarioState.controlsRef,
          evaluatorRef: scenarioState.finalEvaluator,
        } as unknown as CanonicalJsonObject,
        scenarioState.service,
      ),
      scenarioState.sessionFor(scenarioState.service),
    );
    expect(validate2).toMatchObject({ status: 'COMMITTED' });
    const validations2 = record(scenarioState.committedPayload(validate2 as CommandResult));
    const accept2 = await scenarioState.firstRunEntry.acceptAgentResult(
      await scenarioState.firstRunEnvelope(
        'execution.accept_agent_result',
        objectRef(
          'execution.agent_result_acceptance',
          newUuidV7(),
          scenarioState.scope(),
        ) as Common.ObjectRef,
        {
          agentResultRef: result2Ref,
          schemaValidationRef: validations2.schemaValidationRef,
          identityValidationRef: validations2.identityValidationRef,
          runBindingValidationRef: validations2.runBindingValidationRef,
          scopeValidationRef: validations2.scopeValidationRef,
          businessOutputValidationRef: validations2.businessOutputValidationRef,
          disposition: 'ACCEPTED',
          reasons: [],
        } as unknown as CanonicalJsonObject,
        scenarioState.service,
      ),
      scenarioState.sessionFor(scenarioState.service),
    );
    expect(accept2).toMatchObject({ status: 'COMMITTED' });
    const acceptance2 = record(
      scenarioState.committedPayload(accept2 as CommandResult),
    ).acceptanceRecordRef;
    if (scenarioState.recoveryVariant === 'SECOND_EXPIRY_RACE') {
      await scenarioState.waitForDeadline(
        Math.max(0, Date.parse(deadline2) - Date.now() + 100),
        'Run-2 finalize/expiry arbitration',
      );
      scenarioState.clock = Date.now();
      const final = await scenarioState.firstRunEnvelope(
        'execution.finalize_run_from_acceptance',
        run2,
        { acceptanceRecordRef: acceptance2 } as CanonicalJsonObject,
        scenarioState.service,
        3,
      );
      const expiry = await scenarioState.firstRunEnvelope(
        'execution.expire_run',
        run2,
        { reason: 'DEADLINE_EXCEEDED' },
        scenarioState.service,
        3,
      );
      const race = await Promise.allSettled([
        scenarioState.firstRunEntryRaw.finalizeRun(
          final,
          scenarioState.sessionFor(scenarioState.service),
        ),
        scenarioState.firstRunEntryRaw.expireRun(
          expiry,
          scenarioState.sessionFor(scenarioState.service),
        ),
      ]);
      expect(race[0].status).toBe('rejected');
      expect(race[1]).toMatchObject({ status: 'fulfilled', value: { status: 'COMMITTED' } });
      expect(
        (
          await scenarioState.admin.query('SELECT status FROM task_execution.run WHERE run_id=$1', [
            run2.objectId,
          ])
        ).rows,
      ).toEqual([{ status: 'TIMED_OUT' }]);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
            [run2.objectId],
          )
        ).rows,
      ).toEqual([{ status: 'EXPIRED' }]);
      expect(
        (
          await scenarioState.admin.query(
            "SELECT count(*)::int n FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.RunTerminated'",
            [run2.objectId],
          )
        ).rows,
      ).toEqual([{ n: 1 }]);
      const resume = await scenarioState.firstRunEnvelope(
        'execution.start_run',
        run2,
        start2.payload,
        scenarioState.service,
        4,
      );
      await expect(
        scenarioState.firstRunEntryRaw.startRun(
          resume,
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).rejects.toBeDefined();
      expect(
        (
          await scenarioState.admin.query(
            'SELECT attempt_number FROM task_execution.run WHERE work_order_id=$1 ORDER BY attempt_number',
            [scenarioState.woId],
          )
        ).rows,
      ).toEqual([{ attempt_number: 1 }, { attempt_number: 2 }]);
      for (const worker of definedValue(scenarioState.processWorkers)) await worker.stop();
      return true;
    }

    expect(
      await scenarioState.firstRunEntry.finalizeRun(
        await scenarioState.firstRunEnvelope(
          'execution.finalize_run_from_acceptance',
          run2,
          { acceptanceRecordRef: acceptance2 } as unknown as CanonicalJsonObject,
          scenarioState.service,
          3,
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({ status: 'COMMITTED' });
    expect(
      await scenarioState.firstRunEntry.getRunState(
        await scenarioState.firstRunQuery(
          'execution.get_run_state',
          run2,
          { runRef: run2 } as unknown as CanonicalJsonObject,
          'runStateReadV1',
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({
      status: 'SUCCEEDED',
      aggregateVersion: 4,
      resultRef: result2Ref,
    });
    expect(
      await scenarioState.firstRunEntry.getAgentResult(
        await scenarioState.firstRunQuery(
          'execution.get_agent_result',
          result2Ref as Common.ContentAddressedRef,
          { agentResultRef: result2Ref } as CanonicalJsonObject,
          'agentResultReadV1',
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({ agentResultContract: result2Body });
    expect(await reconcileWo(run2)).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { status: 'COMPLETION_PENDING' },
    });
    expect(await reconcileTask(run2)).toMatchObject({
      status: 'COMMITTED',
      resultPayload: {
        status: scenarioState.otherChildId ? 'WAITING_INPUT' : 'COMPLETION_PENDING',
      },
    });
    await scenarioState.boardProbe?.('RECOVERY_SUCCEEDED', run2);
    const woState = await scenarioState.recoveryEntry.read(
      await scenarioState.recoveryEnvelope(
        'workOrderExecutionStateReadV1',
        scenarioState.workOrderRef,
        { workOrderRef: scenarioState.workOrderRef } as unknown as CanonicalJsonObject,
        scenarioState.service,
        undefined,
        true,
      ),
      scenarioState.sessionFor(scenarioState.service),
    );
    expect(woState).toMatchObject({
      status: 'COMPLETION_PENDING',
      blockerRefs: [],
      retryEligibility: 'CONSUMED',
    });
    const taskState = await scenarioState.recoveryEntry.read(
      await scenarioState.recoveryEnvelope(
        'taskStateReadV1',
        scenarioState.revised.taskRef as Common.ObjectRef,
        { taskRef: scenarioState.revised.taskRef } as unknown as CanonicalJsonObject,
        scenarioState.service,
        undefined,
        true,
      ),
      scenarioState.sessionFor(scenarioState.service),
    );
    expect(taskState).toMatchObject({
      status: scenarioState.otherChildId ? 'WAITING_INPUT' : 'COMPLETION_PENDING',
      blockerRefs: scenarioState.otherChildId ? [scenarioState.otherChildResultRef] : [],
      completionUseStatus: 'NOT_EVALUATED',
    });
    if (scenarioState.otherChildId) {
      expect(record(taskState).workOrderRefs).toHaveLength(3);
      expect(record(taskState).workOrderRefs).toContainEqual(
        objectRef(WORK_ORDER_V11, scenarioState.otherChildId, scenarioState.scope()),
      );
      expect(record(taskState).workOrderRefs).toContainEqual(
        objectRef(
          WORK_ORDER_V11,
          definedValue(scenarioState.otherDraftChildId),
          scenarioState.scope(),
        ),
      );
      expect(
        (
          await scenarioState.admin.query(
            'SELECT status FROM task_execution.work_order WHERE work_order_id=$1',
            [scenarioState.otherChildId],
          )
        ).rows,
      ).toEqual([{ status: 'WAITING_INPUT' }]);
      expect(scenarioState.runtimeDriver.invokedAttemptIds).toEqual([
        scenarioState.attemptRef.objectId,
        definedValue(scenarioState.otherChildAttemptRef).objectId,
        attempt2.objectId,
      ]);
      for (const worker of definedValue(scenarioState.processWorkers)) await worker.stop();
      return true;
    }
    expect(
      (
        await scenarioState.admin.query(
          'SELECT attempt_number,status,fencing_token,context_snapshot_ref,capability_grant_ref FROM task_execution.run WHERE work_order_id=$1 ORDER BY attempt_number',
          [scenarioState.woId],
        )
      ).rows,
    ).toMatchObject([
      {
        attempt_number: 1,
        status: 'SUCCEEDED',
        fencing_token: '1',
        context_snapshot_ref: scenarioState.contextRef,
        capability_grant_ref: scenarioState.bundleRef,
      },
      {
        attempt_number: 2,
        status: 'SUCCEEDED',
        fencing_token: '2',
        context_snapshot_ref: context2,
        capability_grant_ref: bundle2Ref,
      },
    ]);
    expect(
      (
        await scenarioState.admin.query(
          "SELECT count(*)::int n FROM task_execution.work_order_run_claim WHERE work_order_id=$1 AND status='ACTIVE'",
          [scenarioState.woId],
        )
      ).rows,
    ).toEqual([{ n: 0 }]);
    expect(
      await scenarioState.admin.query(
        `SELECT to_jsonb(r) run_bytes,a.result_payload result_bytes,ac.canonical_payload acceptance_bytes,c.canonical_payload context_bytes,wc.canonical_payload contract_bytes,r.result_ref,r.acceptance_ref,r.context_snapshot_ref,r.work_order_contract_ref,c.payload_hash context_hash,wc.payload_hash contract_hash FROM task_execution.run r JOIN task_execution.agent_result a USING(run_id) JOIN task_execution.agent_result_acceptance ac USING(result_id) JOIN task_execution.context_snapshot c ON c.snapshot_id=(r.context_snapshot_ref->>'snapshotId')::uuid JOIN task_execution.work_order_contract wc ON wc.contract_id=(r.work_order_contract_ref->>'objectId')::uuid WHERE r.run_id=$1`,
        [scenarioState.runRef.objectId],
      ),
    ).toMatchObject({ rows: savedHistory.rows });
    expect(scenarioState.runtimeDriver.invokedAttemptIds).toEqual([
      scenarioState.attemptRef.objectId,
      attempt2.objectId,
    ]);
    if (scenarioState.exerciseRecoveryFaultMatrix) {
      for (const table of [
        'recovery_command_material',
        'information_request_origin',
        'answer_submission',
        'answer_resolution',
        'resolution_receipt_observation',
        'work_order_retry_intent',
        'run_retry_intent_consumption',
        'run_budget_reservation',
        'run_budget_consumption',
        'recovery_process_command',
      ]) {
        const tableName = `task_execution.${table}`;
        expect(
          (
            await scenarioState.admin.query<{ n: number }>(
              `SELECT count(*)::int n FROM ${tableName} WHERE project_id=$1`,
              [scenarioState.fixture.projectId],
            )
          ).rows[0]?.n,
          table,
        ).toBeGreaterThan(0);
        const hidden = await withTaskExecutionTransaction(
          scenarioState.teDb,
          {
            ...scenarioState.runnerContext(scenarioState.service),
            allowedProjectIds: [newUuidV7()],
          },
          (trx) =>
            sql`SELECT project_id FROM ${sql.table(tableName)} WHERE project_id=${scenarioState.fixture.projectId}::uuid`.execute(
              trx,
            ),
        );
        expect(hidden.rows, `TE-REC-D-011 ${table} foreign Project`).toEqual([]);
        for (const verb of ['UPDATE', 'DELETE']) {
          await expect(
            withTaskExecutionTransaction(
              scenarioState.teDb,
              scenarioState.runnerContext(scenarioState.service),
              (trx) =>
                verb === 'UPDATE'
                  ? sql`UPDATE ${sql.table(tableName)} SET project_id=project_id WHERE project_id=${scenarioState.fixture.projectId}::uuid`.execute(
                      trx,
                    )
                  : sql`DELETE FROM ${sql.table(tableName)} WHERE project_id=${scenarioState.fixture.projectId}::uuid`.execute(
                      trx,
                    ),
            ),
          ).rejects.toMatchObject({ code: '42501' });
          await expect(
            scenarioState.admin.query(
              verb === 'UPDATE'
                ? `UPDATE ${tableName} SET project_id=project_id WHERE project_id=$1`
                : `DELETE FROM ${tableName} WHERE project_id=$1`,
              [scenarioState.fixture.projectId],
            ),
          ).rejects.toMatchObject({ code: '55000' });
        }
      }
    }
    const budgetRows = (
      await scenarioState.admin.query<{
        attempt_number: number;
        reserved_seconds: number;
        total_seconds: number;
        consumed_seconds: number;
      }>(
        'SELECT b.attempt_number,b.reserved_seconds,b.total_seconds,c.consumed_seconds FROM task_execution.run_budget_reservation b JOIN task_execution.run_budget_consumption c USING(run_id) WHERE b.work_order_id=$1 ORDER BY b.attempt_number',
        [scenarioState.woId],
      )
    ).rows;
    expect(budgetRows).toHaveLength(2);
    expect(budgetRows[1]?.reserved_seconds).toBe(
      definedValue(budgetRows[0]).total_seconds - definedValue(budgetRows[0]).consumed_seconds,
    );
    expect(
      budgetRows.every(
        (row) => row.consumed_seconds >= 0 && row.consumed_seconds <= row.reserved_seconds,
      ),
    ).toBe(true);
    const third = await scenarioState.firstRunEnvelope(
      'execution.create_run',
      objectRef('execution.run', newUuidV7(), scenarioState.scope()) as Common.ObjectRef,
      {
        creation: { ...record(record(create2.payload).creation), attemptNumber: 3 },
      },
      scenarioState.service,
    );
    await expect(
      scenarioState.firstRunEntryRaw.createRun(
        third,
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).rejects.toBeDefined();
    expect(await scenarioState.receiptRows(third.idempotencyKey)).toEqual([]);
    expect(
      (
        await scenarioState.admin.query(
          'SELECT attempt_number FROM task_execution.run WHERE work_order_id=$1 ORDER BY attempt_number',
          [scenarioState.woId],
        )
      ).rows,
    ).toEqual([{ attempt_number: 1 }, { attempt_number: 2 }]);
    if (scenarioState.exerciseRecoveryFaultMatrix) {
      const receiptGrant = definedValue(
        scenarioState.recoveryGrants.get(
          `${OPERATOR}:confirmationReceiptDiscoverV1:zhiju.project.command_receipt`,
        ),
      );
      expect(
        await scenarioState.revokeCapabilityTracked(
          scenarioState.identityDeps([scenarioState.fixture.projectId]),
          {
            targetId: receiptGrant,
            expectedAggregateVersion: '1',
            scope: {
              scopeKind: 'PROJECT',
              enterpriseId: scenarioState.fixture.enterpriseId,
              projectId: scenarioState.fixture.projectId,
            },
            reasonCode: 'WI231_REVOKE_RECEIPT_DISCOVERY',
            effectiveAt: new Date(scenarioState.clock),
            idempotencyKey: newUuidV7(),
          },
        ),
      ).toMatchObject({ status: 'COMMITTED' });
      const receiptReads: string[] = [];
      const probe: KyselyPlugin = {
        transformQuery(args) {
          if (['SelectQueryNode', 'RawNode'].includes(args.node.kind))
            receiptReads.push(JSON.stringify(args.node));
          return args.node;
        },
        transformResult: (args) => Promise.resolve(args.result),
      };
      await expect(
        createBlockedInputRecoveryEntry({
          ...scenarioState.recoveryConfig,
          enterpriseProjectDb: scenarioState.enterpriseProjectDb.withPlugin(probe),
        }).discoverReceipt(
          String(confirm.commandId),
          scenarioState.sessionFor(),
          discovery.authorizationDecisionRef,
          scenarioState.scope(),
        ),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
      expect(receiptReads.filter((query) => query.includes('enterprise_project'))).toEqual([]);
    }
    if (scenarioState.exerciseRecoveryFaultMatrix) {
      const resolvedFactsBeforeRevoke = await denialSnapshot();
      const resolveGrant = definedValue(
        scenarioState.recoveryGrants.get(
          `${OPERATOR}:informationRequestResolveV1:execution.information_request`,
        ),
      );
      expect(
        await scenarioState.revokeCapabilityTracked(
          scenarioState.identityDeps([scenarioState.fixture.projectId]),
          {
            targetId: resolveGrant,
            expectedAggregateVersion: '1',
            scope: {
              scopeKind: 'PROJECT',
              enterpriseId: scenarioState.fixture.enterpriseId,
              projectId: scenarioState.fixture.projectId,
            },
            reasonCode: 'WI231_REVOKE_RESOLVE',
            effectiveAt: new Date(scenarioState.clock),
            idempotencyKey: newUuidV7(),
          },
        ),
      ).toMatchObject({ status: 'COMMITTED' });
      scenarioState.queryReads.length = 0;
      await expect(
        createBlockedInputRecoveryEntry({
          ...scenarioState.recoveryConfig,
          taskExecutionDb: scenarioState.guardedTeDb,
        }).command(resolve, scenarioState.sessionFor()),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
      expect(scenarioState.protectedReads()).toEqual([]);
      await expect(
        readRecoveryHumanEligibility(
          scenarioState.identityDeps([scenarioState.fixture.projectId], scenarioState.service),
          definedValue(historicalProof).input,
          definedValue(historicalProof).authority,
        ),
      ).rejects.toBeDefined();
      expect(await denialSnapshot()).toEqual(resolvedFactsBeforeRevoke);
      const roleId = definedValue(
        (
          await scenarioState.admin.query<{ assignment_id: string }>(
            "SELECT id AS assignment_id FROM identity_policy.role_assignment WHERE principal_id=$1 AND project_id=$2 AND role_code='project.customer_material.confirmer' AND status='ACTIVE'",
            [OPERATOR, scenarioState.fixture.projectId],
          )
        ).rows[0]?.assignment_id,
      );
      expect(
        await revokeRole(scenarioState.identityDeps([scenarioState.fixture.projectId]), {
          targetId: roleId,
          expectedAggregateVersion: '1',
          scope: {
            scopeKind: 'PROJECT',
            enterpriseId: scenarioState.fixture.enterpriseId,
            projectId: scenarioState.fixture.projectId,
          },
          reasonCode: 'WI231_REVOKE_CONFIRMER',
          effectiveAt: new Date(scenarioState.clock),
          idempotencyKey: newUuidV7(),
        }),
      ).toMatchObject({ status: 'COMMITTED' });
      scenarioState.queryReads.length = 0;
      const roleGuardedEntry = createBlockedInputRecoveryEntry({
        ...scenarioState.recoveryConfig,
        taskExecutionDb: scenarioState.guardedTeDb,
      });
      const deniedRead = await scenarioState.recoveryEnvelope(
        'informationRequestReadV1',
        requestRef,
        { informationRequestRef: requestRef } as unknown as CanonicalJsonObject,
        scenarioState.operator(),
        undefined,
        true,
      );
      await expect(
        roleGuardedEntry.read(deniedRead, scenarioState.sessionFor()),
      ).rejects.toMatchObject({
        code: 'AUTHORIZATION_DECISION_INVALID',
      });
      expect(scenarioState.protectedReads()).toEqual([]);
    }
    expect(scenarioState.processStep).toBe(13);
    expect(scenarioState.processHandoffs.size).toBe(
      scenarioState.exerciseRecoveryFaultMatrix ? 13 : 0,
    );
    if (scenarioState.exerciseRecoveryFaultMatrix) {
      const coordinationFacts = () =>
        scenarioState.admin.query(
          `SELECT (SELECT count(*)::int FROM task_execution.process_instance WHERE project_id=$1) processes,(SELECT count(*)::int FROM task_execution.command_receipt WHERE project_id=$1) receipts,(SELECT count(*)::int FROM identity_policy.authorization_decision WHERE project_id=$1 AND principal_id=$2 AND command_type='execution.process.recovery_progress') progress_decisions`,
          [scenarioState.fixture.projectId, scenarioState.serviceId],
        );
      const beforeIdleTicks = (await coordinationFacts()).rows;
      const invocationsBeforeIdleTicks = [...scenarioState.runtimeDriver.invokedAttemptIds];
      await Promise.all(definedValue(scenarioState.processWorkers).map((worker) => worker.tick()));
      expect((await coordinationFacts()).rows).toEqual(beforeIdleTicks);
      expect(scenarioState.runtimeDriver.invokedAttemptIds).toEqual(invocationsBeforeIdleTicks);
    }
    for (const worker of definedValue(scenarioState.processWorkers)) await worker.stop();
    expect(final2.runtimeAdapterIdentityRef).not.toEqual(
      scenarioState.finalView.runtimeAdapterIdentityRef,
    );
    expect(record(binding2.acknowledgement).runtimeSessionRef).not.toEqual(
      record(scenarioState.attemptBinding.acknowledgement).runtimeSessionRef,
    );
    if (scenarioState.formal) await scenarioState.completeFormal();
    return true;
  }
  return false;
}
