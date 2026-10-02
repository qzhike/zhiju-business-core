import { createWorkOrderValidationEntry } from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import type { WorkOrderValidationCapabilityKey } from '@zhiju/identity-policy';
import type { UuidV7 } from '@zhiju/shared-kernel';
import {
  type CanonicalJsonObject,
  hashContractPayload,
  newUuidV7,
  sha256CanonicalJson,
} from '@zhiju/shared-kernel';
import pg from 'pg';
import { expect } from 'vitest';
import {
  contentHash,
  definedValue,
  dependencyCapabilities,
  objectRef,
  PAST,
  policyKey,
  type Principal,
  profileReference,
  record,
  WORK_ORDER_V11,
} from './initial-context-fixtures.js';
import type { InitialContextSuite } from './initial-context-suite.js';
import { verifyWorkOrderValidationGuards } from './work-order-validation-guards.js';
export interface VerifyPreparationValidationContext {
  readonly exercisePreparationMatrix: boolean;
  admin: InitialContextSuite['admin'];
  teDb: InitialContextSuite['teDb'];
  readonly runnerContext: InitialContextSuite['runnerContext'];
  service: Principal;
  readonly judgmentId: string;
  readonly judgmentPayload: Record<string, unknown>;
  readonly contextRef: Common.SnapshotRef;
  readonly envelope: (
    commandType: string,
    payload: CanonicalJsonObject,
    targetRef: Common.ObjectRef,
    freeze?: boolean,
  ) => Promise<{
    payload: CanonicalJsonObject;
    integrity: { canonicalizationVersion: string; payloadHash: Common.ContentHash };
    expectedAggregateVersion?: number;
    commandId: UuidV7;
    commandType: string;
    commandVersion: string;
    scopeRef: Record<string, string>;
    targetRef: Common.ObjectRef;
    actor: Common.SnapshotRef;
    authorizationDecisionRef: Common.ContentAddressedRef | undefined;
    idempotencyKey: UuidV7;
    correlationId: UuidV7;
    requestedAt: string;
  }>;
  readonly revised: Record<string, unknown>;
  readonly judgmentRef: unknown;
  readonly entry: ReturnType<typeof createWorkOrderValidationEntry>;
  readonly sessionFor: InitialContextSuite['sessionFor'];
  readonly receiptRows: InitialContextSuite['receiptRows'];
  readonly createWorkOrder: InitialContextSuite['createWorkOrder'];
  readonly taskId: string;
  readonly expiresAt: string;
  readonly draftSnapshotRefOf: InitialContextSuite['draftSnapshotRefOf'];
  initialContextEntry: InitialContextSuite['initialContextEntry'];
  readonly preparedBuild: InitialContextSuite['preparedBuild'];
  readonly slice: Common.ContentAddressedRef;
  readonly contextSnapshotRefOf: InitialContextSuite['contextSnapshotRefOf'];
  readonly scope: InitialContextSuite['scope'];
  readonly specFields: string[];
  readonly validationRef: Common.VersionedRef;
  readonly evaluator: Common.VersionedRef | undefined;
  readonly committedPayload: InitialContextSuite['committedPayload'];
  fixture: InitialContextSuite['fixture'];
  readonly registerPolicyVersionAs: InitialContextSuite['registerPolicyVersionAs'];
  readonly validationEnvelope: {
    payload: CanonicalJsonObject;
    integrity: { canonicalizationVersion: string; payloadHash: Common.ContentHash };
    expectedAggregateVersion?: number;
    commandId: UuidV7;
    commandType: string;
    commandVersion: string;
    scopeRef: Record<string, string>;
    targetRef: Common.ObjectRef;
    actor: Common.SnapshotRef;
    authorizationDecisionRef: Common.ContentAddressedRef | undefined;
    idempotencyKey: UuidV7;
    correlationId: UuidV7;
    requestedAt: string;
  };
  enterpriseProjectDb: InitialContextSuite['enterpriseProjectDb'];
  identityDb: InitialContextSuite['identityDb'];
  identityRepo: InitialContextSuite['identityRepo'];
  readonly crypto: InitialContextSuite['crypto'];
  readonly codes: Readonly<Record<WorkOrderValidationCapabilityKey, string>>;
  clock: InitialContextSuite['clock'];
  activeDatabaseUrl: InitialContextSuite['activeDatabaseUrl'];
  readonly woId: string;
}

export async function verifyPreparationValidation(
  scenarioState: VerifyPreparationValidationContext,
): Promise<boolean> {
  if (scenarioState.exercisePreparationMatrix) {
    await verifyWorkOrderValidationGuards(
      scenarioState.admin,
      scenarioState.teDb,
      scenarioState.runnerContext(scenarioState.service),
      scenarioState.judgmentId,
    );
    expect((scenarioState.judgmentPayload.dependencyObservations as unknown[]).length).toBe(7);
    expect(scenarioState.contextRef.objectId).not.toBe(scenarioState.contextRef.snapshotId);
    expect(
      (
        await scenarioState.admin.query(
          'SELECT task_execution.work_order_validation_payload_valid($1::jsonb) AS valid',
          [JSON.stringify(scenarioState.judgmentPayload)],
        )
      ).rows,
    ).toEqual([{ valid: true }]);
    for (const mutate of [
      (p: Record<string, unknown>) => {
        p.extra = true;
      },
      (p: Record<string, unknown>) => {
        (p.dependencyObservations as unknown[]).reverse();
      },
      (p: Record<string, unknown>) => {
        record((p.dependencyObservations as unknown[])[0]).extra = true;
      },
      (p: Record<string, unknown>) => {
        record(p.validation).executable = false;
      },
      (p: Record<string, unknown>) => {
        p.inputHash = 'f'.repeat(64);
      },
    ]) {
      const value = structuredClone(scenarioState.judgmentPayload);
      mutate(value);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT task_execution.work_order_validation_payload_valid($1::jsonb) AS valid',
            [JSON.stringify(value)],
          )
        ).rows,
      ).toEqual([{ valid: false }]);
    }
    await expect(
      scenarioState.admin.query(
        'UPDATE task_execution.execution_judgment SET valid_until=valid_until WHERE judgment_id=$1',
        [scenarioState.judgmentId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const badJudgment = await scenarioState.envelope(
      'execution.freeze_work_order',
      {
        workOrderContract: scenarioState.revised,
        validationSnapshotRef: {
          ...record(scenarioState.judgmentRef),
          contentHash: contentHash('f'.repeat(64)),
        },
        specificationHash: scenarioState.revised.specificationHash,
      } as unknown as CanonicalJsonObject,
      scenarioState.revised.workOrderRef as Common.ObjectRef,
      true,
    );
    await expect(
      scenarioState.entry.freeze(badJudgment, scenarioState.sessionFor(scenarioState.service)),
    ).rejects.toMatchObject({
      code: 'REFERENCE_INVALID',
    });
    expect(await scenarioState.receiptRows(badJudgment.idempotencyKey)).toEqual([]);
    // A lawful, smaller budget still differs from the exact Controls Policy.
    // Produce a separate owning Draft/Context so the mismatch is a business
    // judgment, rather than a forged change to the original immutable Draft.
    const businessCandidate = structuredClone(scenarioState.revised);
    record(businessCandidate.budget).tokenLimit = 100;
    const businessDraft = Object.fromEntries(
      Object.entries(businessCandidate).filter(
        ([key]) =>
          ![
            'header',
            'workOrderRef',
            'projectRef',
            'contextSnapshotRef',
            'issuedAt',
            'expiresAt',
            'specificationHash',
          ].includes(key),
      ),
    );
    const { projectContextContractRef: oldContext, ...businessPins } = record(
      businessDraft.versionPins,
    );
    void oldContext;
    businessDraft.versionPins = businessPins;
    const businessWo = await scenarioState.createWorkOrder({
      taskId: scenarioState.taskId,
      taskMajor: '2.0',
      customDraft: businessDraft,
      expiresAt: scenarioState.expiresAt,
    });
    const businessDraftRef = await scenarioState.draftSnapshotRefOf(businessWo);
    const businessBuild = await scenarioState.initialContextEntry.build(
      await scenarioState.preparedBuild({
        workOrderId: businessWo,
        draftRef: businessDraftRef,
        principal: scenarioState.service,
        sourceSlices: [scenarioState.slice],
        idempotencyKey: newUuidV7(),
      }),
      scenarioState.sessionFor(scenarioState.service),
    );
    const businessContext = scenarioState.contextSnapshotRefOf(businessBuild);
    businessCandidate.workOrderRef = objectRef(WORK_ORDER_V11, businessWo, scenarioState.scope());
    businessCandidate.contextSnapshotRef = businessContext;
    record(businessCandidate.versionPins).projectContextContractRef = businessContext;
    record(businessCandidate.header).contractId = newUuidV7();
    businessCandidate.specificationHash = contentHash(
      sha256CanonicalJson(
        Object.fromEntries(
          scenarioState.specFields.map((k) => [k, businessCandidate[k]]),
        ) as CanonicalJsonObject,
      ),
    );
    record(businessCandidate.header).payloadHash = contentHash(
      hashContractPayload(businessCandidate as CanonicalJsonObject),
    );
    const businessEnvelope = await scenarioState.envelope(
      'execution.validate_work_order_draft',
      {
        draftSnapshotRef: businessDraftRef,
        candidateContract: businessCandidate,
        policyRef: scenarioState.validationRef,
        evaluatorRef: scenarioState.evaluator,
      } as unknown as CanonicalJsonObject,
      objectRef(
        'zhiju.execution.work_order_validation',
        newUuidV7(),
        scenarioState.scope(),
      ) as unknown as Common.ObjectRef,
    );
    const businessResult = await scenarioState.entry.validate(
      businessEnvelope,
      scenarioState.sessionFor(scenarioState.service),
    );
    expect(businessResult).toMatchObject({ status: 'COMMITTED' });
    const businessJudgmentRef = record(
      record(scenarioState.committedPayload(businessResult)).data,
    ).validationSnapshotRef;
    const businessRow = definedValue(
      (
        await scenarioState.admin.query<{ canonical_payload: Record<string, unknown> }>(
          'SELECT canonical_payload FROM task_execution.execution_judgment WHERE judgment_id=$1',
          [record(businessJudgmentRef).objectId],
        )
      ).rows[0],
    ).canonical_payload;
    expect(record(businessRow).validation).toMatchObject({
      budgetValid: false,
      executable: false,
      violations: ['BUDGET_CONTROL_MISMATCH'],
    });
    const businessFreeze = await scenarioState.envelope(
      'execution.freeze_work_order',
      {
        workOrderContract: businessCandidate,
        validationSnapshotRef: businessJudgmentRef,
        specificationHash: businessCandidate.specificationHash,
      } as CanonicalJsonObject,
      businessCandidate.workOrderRef as Common.ObjectRef,
      true,
    );
    await expect(
      scenarioState.entry.freeze(businessFreeze, scenarioState.sessionFor(scenarioState.service)),
    ).rejects.toMatchObject({
      code: 'EXECUTION_JUDGMENT_INVALID',
    });
    expect(await scenarioState.receiptRows(businessFreeze.idempotencyKey)).toEqual([]);
    const shortPolicy = policyKey([newUuidV7(), newUuidV7()], scenarioState.fixture);
    await scenarioState.registerPolicyVersionAs({
      key: shortPolicy,
      factId: newUuidV7(),
      idempotencyKey: newUuidV7(),
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference('execution.work_order_validation.policy@1.0')],
      policyDocument: { maxValidationValiditySeconds: 2 },
    });
    const shortEnvelope = await scenarioState.envelope(
      'execution.validate_work_order_draft',
      {
        ...scenarioState.validationEnvelope.payload,
        policyRef: shortPolicy,
      } as unknown as CanonicalJsonObject,
      objectRef(
        'zhiju.execution.work_order_validation',
        newUuidV7(),
        scenarioState.scope(),
      ) as unknown as Common.ObjectRef,
    );
    const shortResult = await scenarioState.entry.validate(
      shortEnvelope,
      scenarioState.sessionFor(scenarioState.service),
    );
    const shortRef = record(
      record(scenarioState.committedPayload(shortResult)).data,
    ).validationSnapshotRef;
    const expiredFreeze = await scenarioState.envelope(
      'execution.freeze_work_order',
      {
        workOrderContract: scenarioState.revised,
        validationSnapshotRef: shortRef,
        specificationHash: scenarioState.revised.specificationHash,
      } as CanonicalJsonObject,
      scenarioState.revised.workOrderRef as Common.ObjectRef,
      true,
    );
    const laterEntry = createWorkOrderValidationEntry({
      taskExecutionDb: scenarioState.teDb,
      enterpriseProjectDb: scenarioState.enterpriseProjectDb,
      identity: {
        db: scenarioState.identityDb,
        repo: scenarioState.identityRepo,
        crypto: scenarioState.crypto,
      },
      capabilityCodes: scenarioState.codes,
      capabilities: dependencyCapabilities,
      now: () => new Date(scenarioState.clock + 10000),
    });
    await expect(
      laterEntry.freeze(expiredFreeze, scenarioState.sessionFor(scenarioState.service)),
    ).rejects.toMatchObject({
      code: 'EXECUTION_JUDGMENT_STALE',
    });
    expect(await scenarioState.receiptRows(expiredFreeze.idempotencyKey)).toEqual([]);
    // Hold the real WorkOrder row lock after authorization, then cross the
    // judgment deadline before releasing it. No partial Freeze can commit.
    let lockClock = scenarioState.clock;
    const lockEntry = createWorkOrderValidationEntry({
      taskExecutionDb: scenarioState.teDb,
      enterpriseProjectDb: scenarioState.enterpriseProjectDb,
      identity: {
        db: scenarioState.identityDb,
        repo: scenarioState.identityRepo,
        crypto: scenarioState.crypto,
      },
      capabilityCodes: scenarioState.codes,
      capabilities: dependencyCapabilities,
      now: () => new Date(lockClock),
    });
    const blocker = new pg.Client({ connectionString: scenarioState.activeDatabaseUrl });
    await blocker.connect();
    let pendingFreeze: Promise<unknown> | undefined;
    try {
      await blocker.query('BEGIN');
      const blockerPid = definedValue(
        (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0],
      ).pid;
      await blocker.query(
        'SELECT work_order_id FROM task_execution.work_order WHERE work_order_id=$1 FOR UPDATE',
        [scenarioState.woId],
      );
      pendingFreeze = lockEntry
        .freeze(expiredFreeze, scenarioState.sessionFor(scenarioState.service))
        .catch((error: unknown) => error);
      await expect
        .poll(
          async () =>
            (
              await scenarioState.admin.query<{ n: number }>(
                'SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',
                [blockerPid],
              )
            ).rows[0]?.n ?? 0,
          { timeout: 10000 },
        )
        .toBeGreaterThan(0);
      lockClock += 10000;
      await blocker.query('ROLLBACK');
      expect(await pendingFreeze).toMatchObject({ code: 'EXECUTION_JUDGMENT_STALE' });
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
      await pendingFreeze;
    }
    expect(await scenarioState.receiptRows(expiredFreeze.idempotencyKey)).toEqual([]);
    const conflictEnvelope = await scenarioState.envelope(
      'execution.validate_work_order_draft',
      {
        ...scenarioState.validationEnvelope.payload,
        policyRef: shortPolicy,
      } as unknown as CanonicalJsonObject,
      scenarioState.validationEnvelope.targetRef,
    );
    await expect(
      scenarioState.entry.validate(
        { ...conflictEnvelope, idempotencyKey: scenarioState.validationEnvelope.idempotencyKey },
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_CONFLICT' });
  }
  return false;
}
