import type {
  createBlockedInputRecoveryEntry,
  createControlledFirstRunEntry,
  createFormalCompletionEntry,
  FormalCompletionEntryConfig,
} from '@zhiju/api/composition';
import type { ArtifactDb } from '@zhiju/artifact';
import { handleWithdrawRevision } from '@zhiju/artifact';
import { type Common, registeredEvaluatorProfileReference } from '@zhiju/contracts';
import { formalCompletionBindings } from '@zhiju/identity-policy';
import type { UuidV7 } from '@zhiju/shared-kernel';
import { type CanonicalJsonObject, newUuidV7 } from '@zhiju/shared-kernel';
import {
  type TaskExecutionTransactionContext,
  withTaskExecutionTransaction,
} from '@zhiju/task-execution';
import { type Kysely, sql } from 'kysely';
import pg from 'pg';
import { expect } from 'vitest';
import {
  CORRELATION,
  definedValue,
  type DeliveryScheduleHooks,
  OPERATOR,
  OPERATOR_ACTOR,
  POLICY_SNAPSHOT_ID,
  policyKey,
  type Principal,
  profileReference,
  record,
  REQUEST_DECISION,
} from './initial-context-fixtures.js';
import type {
  ScenarioFirstRunEnvelope,
  ScenarioFormalEnvelope,
  ScenarioQuality,
  ScenarioRecoveryEnvelope,
  ScenarioTerminalScenario,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifyFormalCompletionContext {
  readonly phase: InitialContextSuite['phase'];
  readonly terminalScenario: ScenarioTerminalScenario;
  replayFormalCreation: (() => Promise<unknown>) | undefined;
  readonly bounded: boolean;
  admin: InitialContextSuite['admin'];
  readonly woId: string;
  readonly firstRunEntry: ReturnType<typeof createControlledFirstRunEntry>;
  readonly firstRunEnvelope: ScenarioFirstRunEnvelope;
  readonly workOrderRef: Common.ObjectRef;
  readonly runRef: Common.ObjectRef;
  service: Principal;
  readonly sessionFor: InitialContextSuite['sessionFor'];
  readonly taskId: string;
  readonly recoveryEntry: ReturnType<typeof createBlockedInputRecoveryEntry>;
  readonly recoveryEnvelope: ScenarioRecoveryEnvelope;
  readonly revised: Record<string, unknown>;
  readonly completionRef: Common.VersionedRef;
  readonly formalEnvelope: ScenarioFormalEnvelope;
  readonly formalEntry: ReturnType<typeof createFormalCompletionEntry>;
  readonly receiptRows: InitialContextSuite['receiptRows'];
  teDb: InitialContextSuite['teDb'];
  readonly runnerContext: InitialContextSuite['runnerContext'];
  readonly committedPayload: InitialContextSuite['committedPayload'];
  readonly delivery: boolean;
  readonly deliveryRequiredRelease: boolean;
  activeDatabaseUrl: InitialContextSuite['activeDatabaseUrl'];
  readonly createWorkOrderResult: InitialContextSuite['createWorkOrderResult'];
  readonly draft: Record<string, unknown>;
  readonly revokeCapabilityTracked: InitialContextSuite['revokeCapabilityTracked'];
  readonly identityDeps: InitialContextSuite['identityDeps'];
  fixture: InitialContextSuite['fixture'];
  readonly formalGrants: Map<string, string>;
  clock: InitialContextSuite['clock'];
  readonly deliverySchedule: DeliveryScheduleHooks | undefined;
  readonly deliveryPlan:
    | {
        deliveryPlanRef: Common.VersionedRef;
        deliveryItemRef: Common.VersionedRef;
        completionCriteria: {
          profile: string;
          allOf: (
            | { eventType: string; taskRef: CanonicalJsonObject; factRef?: never }
            | { eventType: string; factRef: CanonicalJsonObject; taskRef?: never }
          )[];
        };
        releaseRef: CanonicalJsonObject;
        additionalItems: {
          completionCriteria: {
            profile: string;
            allOf: (
              | { eventType: string; taskRef: CanonicalJsonObject; factRef?: never }
              | { eventType: string; factRef: CanonicalJsonObject; taskRef?: never }
            )[];
          };
          deliveryItemRef: {
            kind: 'VERSIONED';
            objectType: string;
            objectId: UuidV7;
            versionId: string;
            scope: { enterpriseId: string; projectId: string };
          };
        }[];
      }
    | undefined;
  readonly track: InitialContextSuite['track'];
  readonly verifyDeliveryTail: InitialContextSuite['verifyDeliveryTail'];
  readonly formalFixture:
    | {
        taskCriteria: string[];
        workOrderCriteria: string[];
        runtimeTemplates: string[];
        expected: {
          runCount: number;
          workOrderStatus: string;
          taskStatus: string;
          completionUseStatus: string;
          completedEventsPerRoot: number;
        };
      }
    | undefined;
  readonly createExecutableTask: InitialContextSuite['createExecutableTask'];
  readonly readyTaskForValidation: InitialContextSuite['readyTaskForValidation'];
  readonly formalConfig: FormalCompletionEntryConfig;
  readonly grant: InitialContextSuite['grant'];
  readonly formalCodes: Record<string, string>;
  actualFormalOutput: CanonicalJsonObject | undefined;
  readonly artifactDb: Kysely<ArtifactDb>;
  readonly registerPolicyVersionAs: InitialContextSuite['registerPolicyVersionAs'];
  readonly qualityProfile:
    { profileRef: Common.VersionedRef; gateId: UuidV7; approvalRequirementId: string } | undefined;
  readonly quality: ScenarioQuality;
  actualFormalArtifact: Common.ObjectRef | undefined;
  readonly other: InitialContextSuite['other'];
}

export async function verifyFormalCompletion(
  scenarioState: VerifyFormalCompletionContext,
): Promise<void> {
  scenarioState.phase('formal completion: reconciliation and preparation');
  if (scenarioState.terminalScenario !== 'FORMAL_EMPTY')
    expect(await definedValue(scenarioState.replayFormalCreation)()).toMatchObject({
      status: 'DUPLICATE',
    });
  if (!scenarioState.bounded) {
    const version = Number(
      definedValue(
        (
          await scenarioState.admin.query<{ aggregate_version: string }>(
            'SELECT aggregate_version FROM task_execution.work_order WHERE work_order_id=$1',
            [scenarioState.woId],
          )
        ).rows[0],
      ).aggregate_version,
    );
    expect(
      await scenarioState.firstRunEntry.reconcile(
        await scenarioState.firstRunEnvelope(
          'execution.reconcile_work_order_execution',
          scenarioState.workOrderRef,
          { triggerRef: scenarioState.runRef } as unknown as CanonicalJsonObject,
          scenarioState.service,
          version,
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({ status: 'COMMITTED' });
    const taskVersion = Number(
      definedValue(
        (
          await scenarioState.admin.query<{ aggregate_version: string }>(
            'SELECT aggregate_version FROM task_execution.task WHERE task_id=$1',
            [scenarioState.taskId],
          )
        ).rows[0],
      ).aggregate_version,
    );
    expect(
      await scenarioState.recoveryEntry.command(
        await scenarioState.recoveryEnvelope(
          'taskReconcileV1',
          scenarioState.revised.taskRef as Common.ObjectRef,
          { triggerRef: scenarioState.runRef } as unknown as CanonicalJsonObject,
          scenarioState.service,
          taskVersion,
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({ status: 'COMMITTED' });
  }
  const payload = {
    policyRef: scenarioState.completionRef,
    evaluatorRef: registeredEvaluatorProfileReference(
      'im06-evaluator-static-v1',
      'te.work_order_completion.evaluator@1.0',
    ),
  } as unknown as CanonicalJsonObject;
  const woVersion = Number(
    definedValue(
      (
        await scenarioState.admin.query<{ aggregate_version: string }>(
          'SELECT aggregate_version FROM task_execution.work_order WHERE work_order_id=$1',
          [scenarioState.woId],
        )
      ).rows[0],
    ).aggregate_version,
  );
  const woEnvelope = await scenarioState.formalEnvelope(
    'workOrderCompletionEvaluateV2',
    scenarioState.workOrderRef,
    payload,
    scenarioState.service,
    woVersion,
  );
  if (!('commandId' in woEnvelope)) throw new Error('Expected a Completion command');
  if (scenarioState.terminalScenario === 'FORMAL_NORMAL') {
    scenarioState.phase('formal completion: evaluation input refusal matrix');
    const evaluationInputKeys = [
      'targetRef',
      'definitionRef',
      'criteriaHash',
      'policyObservation',
      'evaluatorRef',
      'collectionHash',
      'observedLocalSources',
      'sourceFacts',
    ];
    const rehash = `NEW.canonical_payload := jsonb_set(NEW.canonical_payload,'{collectionHash,digest}',to_jsonb(encode(task_execution.recovery_payload_hash(NEW.canonical_payload->'observedLocalSources'),'hex')));
            NEW.canonical_payload := jsonb_set(NEW.canonical_payload,'{inputHash,digest}',to_jsonb(encode(task_execution.recovery_payload_hash((SELECT jsonb_object_agg(k,NEW.canonical_payload->k) FROM unnest(ARRAY[${evaluationInputKeys.map((k) => `'${k}'`).join(',')}]) k) || CASE WHEN NEW.canonical_payload ? 'qualitySelection' THEN jsonb_build_object('qualitySelection',NEW.canonical_payload->'qualitySelection') ELSE '{}'::jsonb END),'hex')));
            NEW.payload_hash:=task_execution.recovery_payload_hash(NEW.canonical_payload);`;
    for (const [label, mutation] of [
      ['wrong hash', "NEW.payload_hash:=decode(repeat('0',64),'hex');"],
      ['wrong Scope', `NEW.project_id:='${newUuidV7()}'::uuid;`],
      ['wrong Receipt', `NEW.source_command_id:='${newUuidV7()}'::uuid;`],
      [
        'unknown member',
        `NEW.canonical_payload:=NEW.canonical_payload||'{"unexpected":true}'::jsonb; ${rehash}`,
      ],
      [
        'wrong definition',
        `NEW.canonical_payload:=jsonb_set(NEW.canonical_payload,'{definitionRef,objectId}',to_jsonb('${newUuidV7()}'::text)); ${rehash}`,
      ],
      [
        'omitted source',
        `NEW.canonical_payload:=jsonb_set(NEW.canonical_payload,'{observedLocalSources}',(NEW.canonical_payload->'observedLocalSources')-0); ${rehash}`,
      ],
      [
        'wrong source owner',
        `NEW.canonical_payload:=jsonb_set(NEW.canonical_payload,'{observedLocalSources,0,ref,objectId}',to_jsonb('${newUuidV7()}'::text)); ${rehash}`,
      ],
      [
        'wrong Decision hash',
        `NEW.canonical_payload:=jsonb_set(NEW.canonical_payload,'{authorizationDecisionRef,contentHash,digest}',to_jsonb(repeat('0',64))); ${rehash}`,
      ],
      [
        'wrong Decision Scope',
        `NEW.canonical_payload:=jsonb_set(NEW.canonical_payload,'{authorizationDecisionRef,scope,projectId}',to_jsonb('${newUuidV7()}'::text)); ${rehash}`,
      ],
      [
        'wrong Decision type',
        `NEW.canonical_payload:=jsonb_set(NEW.canonical_payload,'{authorizationDecisionRef,objectType}','"identity.unrelated_fact"'::jsonb); ${rehash}`,
      ],
      [
        'wrong Actor Scope',
        `NEW.canonical_payload:=jsonb_set(NEW.canonical_payload,'{actorSnapshotRef,scope,projectId}',to_jsonb('${newUuidV7()}'::text)); ${rehash}`,
      ],
      [
        'false criterion',
        `NEW.canonical_payload:=jsonb_set(NEW.canonical_payload,'{criterionResults,0,outcome}','"UNSATISFIED"'::jsonb); ${rehash}`,
      ],
    ]) {
      await scenarioState.admin.query(
        `CREATE FUNCTION task_execution.wi235_mutation() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN ${mutation} RETURN NEW; END $f$`,
      );
      await scenarioState.admin.query(
        `CREATE TRIGGER aa_wi235_mutation BEFORE INSERT ON task_execution.completion_evaluation FOR EACH ROW WHEN (NEW.source_command_id='${woEnvelope.commandId}'::uuid) EXECUTE FUNCTION task_execution.wi235_mutation()`,
      );
      try {
        await expect(
          scenarioState.formalEntry.evaluateWorkOrder(
            woEnvelope,
            scenarioState.sessionFor(scenarioState.service),
          ),
          `TE-COMP-D-018 ${label}`,
        ).rejects.toMatchObject({ code: '23514' });
      } finally {
        await scenarioState.admin.query(
          'DROP TRIGGER aa_wi235_mutation ON task_execution.completion_evaluation',
        );
        await scenarioState.admin.query('DROP FUNCTION task_execution.wi235_mutation()');
      }
      expect(await scenarioState.receiptRows(woEnvelope.idempotencyKey)).toEqual([]);
    }
    scenarioState.phase('formal completion: atomic rollback matrix');
    for (const [table, timing, event, condition] of [
      [
        'completion_evaluation',
        'AFTER',
        'INSERT',
        `NEW.source_command_id='${woEnvelope.commandId}'::uuid`,
      ],
      ['completion_source_observation', 'AFTER', 'INSERT', 'true'],
      [
        'work_order',
        'AFTER',
        'UPDATE',
        `NEW.work_order_id='${scenarioState.woId}'::uuid AND NEW.current_completion_evaluation_id IS DISTINCT FROM OLD.current_completion_evaluation_id`,
      ],
      [
        'reference_edge',
        'AFTER',
        'INSERT',
        `NEW.source_command_id='${woEnvelope.commandId}'::uuid`,
      ],
      ['outbox_event', 'AFTER', 'INSERT', `NEW.source_command_id='${woEnvelope.commandId}'::uuid`],
      [
        'command_receipt',
        'AFTER',
        'UPDATE',
        `NEW.command_id='${woEnvelope.commandId}'::uuid AND NEW.outcome='COMMITTED'`,
      ],
      ['audit_record', 'AFTER', 'INSERT', `NEW.command_id='${woEnvelope.commandId}'::uuid`],
    ]) {
      await scenarioState.admin.query(
        "CREATE FUNCTION task_execution.wi235_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'wi235 atomic fault' USING ERRCODE='P0001'; END $f$",
      );
      await scenarioState.admin.query(
        `CREATE TRIGGER zz_wi235_fault ${timing} ${event} ON task_execution.${table} FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION task_execution.wi235_fault()`,
      );
      try {
        await expect(
          scenarioState.formalEntry.evaluateWorkOrder(
            woEnvelope,
            scenarioState.sessionFor(scenarioState.service),
          ),
          `TE-COMP-D-016 ${table}`,
        ).rejects.toMatchObject({ code: 'P0001' });
      } finally {
        await scenarioState.admin.query(`DROP TRIGGER zz_wi235_fault ON task_execution.${table}`);
        await scenarioState.admin.query('DROP FUNCTION task_execution.wi235_fault()');
      }
      // Observe all rollback invariants at the same checkpoint in one round trip.
      const rollback = definedValue(
        (
          await scenarioState.admin.query<{
            receipt_count: number;
            evaluation_count: number;
            work_orders: {
              aggregate_version: string;
              current_completion_evaluation_id: string | null;
            }[];
          }>(
            `SELECT
                     (SELECT count(*)::int FROM task_execution.command_receipt
                       WHERE idempotency_key=$1) AS receipt_count,
                     (SELECT count(*)::int FROM task_execution.completion_evaluation
                       WHERE source_command_id=$2) AS evaluation_count,
                     (SELECT coalesce(jsonb_agg(row_to_json(w)), '[]'::jsonb)
                        FROM (SELECT aggregate_version::text, current_completion_evaluation_id
                                FROM task_execution.work_order WHERE work_order_id=$3) w)
                       AS work_orders`,
            [woEnvelope.idempotencyKey, woEnvelope.commandId, scenarioState.woId],
          )
        ).rows[0],
      );
      expect(rollback.receipt_count).toBe(0);
      expect(rollback.evaluation_count).toBe(0);
      expect(rollback.work_orders).toEqual([
        { aggregate_version: String(woVersion), current_completion_evaluation_id: null },
      ]);
    }
  }
  scenarioState.phase('formal completion: WorkOrder evaluation');
  const woResult = await scenarioState.formalEntry.evaluateWorkOrder(
    woEnvelope,
    scenarioState.sessionFor(scenarioState.service),
  );
  if (scenarioState.terminalScenario === 'FORMAL_EMPTY') {
    expect(woResult).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { outcome: 'UNSATISFIED', transitioned: false },
    });
    const taskVersion = Number(
      definedValue(
        (
          await scenarioState.admin.query<{ aggregate_version: string }>(
            'SELECT aggregate_version FROM task_execution.task WHERE task_id=$1',
            [scenarioState.taskId],
          )
        ).rows[0],
      ).aggregate_version,
    );
    const taskNegative = await scenarioState.formalEntry.evaluateTask(
      await scenarioState.formalEnvelope(
        'taskCompletionEvaluateV2',
        scenarioState.revised.taskRef as Common.ObjectRef,
        {
          ...payload,
          evaluatorRef: registeredEvaluatorProfileReference(
            'im06-evaluator-static-v1',
            'te.task_completion.evaluator@1.0',
          ),
        } as unknown as CanonicalJsonObject,
        scenarioState.service,
        taskVersion,
      ),
      scenarioState.sessionFor(scenarioState.service),
    );
    expect(taskNegative).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { outcome: 'UNSATISFIED', transitioned: false },
    });
    expect(
      (
        await scenarioState.admin.query(
          "SELECT run.status,ac.canonical_payload->>'disposition' acceptance_status,result_payload->'businessOutputs' outputs FROM task_execution.run JOIN task_execution.agent_result USING(run_id) JOIN task_execution.agent_result_acceptance ac USING(run_id) WHERE run_id=$1",
          [scenarioState.runRef.objectId],
        )
      ).rows,
    ).toEqual([{ status: 'SUCCEEDED', acceptance_status: 'ACCEPTED', outputs: [] }]);
    expect(
      (
        await scenarioState.admin.query(
          "SELECT count(*)::int n FROM task_execution.outbox_event WHERE aggregate_id=ANY($1::uuid[]) AND event_type IN('execution.WorkOrderCompleted','execution.TaskCompleted')",
          [[scenarioState.woId, scenarioState.taskId]],
        )
      ).rows,
    ).toEqual([{ n: 0 }]);
    return;
  }
  expect(woResult, JSON.stringify(woResult)).toMatchObject({
    status: 'COMMITTED',
    resultPayload: { outcome: 'SATISFIED', transitioned: true },
  });
  if (scenarioState.terminalScenario === 'FORMAL_NORMAL') {
    const readRows = (context: TaskExecutionTransactionContext) =>
      withTaskExecutionTransaction(scenarioState.teDb, context, (trx) =>
        sql`SELECT evaluation_id FROM task_execution.completion_evaluation WHERE target_id=${scenarioState.woId}::uuid`.execute(
          trx,
        ),
      );
    expect((await readRows(scenarioState.runnerContext(scenarioState.service))).rows).toHaveLength(
      1,
    );
    expect(
      (
        await readRows({
          ...scenarioState.runnerContext(scenarioState.service),
          allowedProjectIds: [newUuidV7()],
        })
      ).rows,
    ).toEqual([]);
    expect((await readRows(scenarioState.runnerContext(scenarioState.service))).rows).toHaveLength(
      1,
    );
    for (const action of ['UPDATE', 'DELETE'])
      await expect(
        scenarioState.admin.query(
          action === 'UPDATE'
            ? 'UPDATE task_execution.completion_evaluation SET canonical_payload=canonical_payload WHERE target_id=$1'
            : 'DELETE FROM task_execution.completion_evaluation WHERE target_id=$1',
          [scenarioState.woId],
        ),
      ).rejects.toMatchObject({ code: '55000' });
  }
  expect(
    await scenarioState.formalEntry.evaluateWorkOrder(
      woEnvelope,
      scenarioState.sessionFor(scenarioState.service),
    ),
  ).toMatchObject({
    status: 'DUPLICATE',
    resultPayload: scenarioState.committedPayload(woResult),
  });
  const taskVersion = Number(
    definedValue(
      (
        await scenarioState.admin.query<{ aggregate_version: string }>(
          'SELECT aggregate_version FROM task_execution.task WHERE task_id=$1',
          [scenarioState.taskId],
        )
      ).rows[0],
    ).aggregate_version,
  );
  scenarioState.phase('formal completion: Task evaluation and concurrency');
  const taskEnvelope = await scenarioState.formalEnvelope(
    'taskCompletionEvaluateV2',
    scenarioState.revised.taskRef as Common.ObjectRef,
    {
      ...payload,
      evaluatorRef: definedValue(
        registeredEvaluatorProfileReference(
          'im06-evaluator-static-v1',
          'te.task_completion.evaluator@1.0',
        ),
      ) as unknown as CanonicalJsonObject,
    },
    scenarioState.service,
    taskVersion,
  );
  if (scenarioState.delivery && scenarioState.deliveryRequiredRelease)
    (taskEnvelope as unknown as Record<string, unknown>).causationId = newUuidV7();
  if (scenarioState.terminalScenario === 'FORMAL_CHILD_FIRST') {
    const blocker = new pg.Client({ connectionString: scenarioState.activeDatabaseUrl });
    await blocker.connect();
    let child: ReturnType<typeof scenarioState.createWorkOrderResult> | undefined;
    let completion:
      | Promise<
          PromiseSettledResult<Awaited<ReturnType<typeof scenarioState.formalEntry.evaluateTask>>>
        >
      | undefined;
    try {
      await blocker.query('BEGIN');
      const pid = definedValue(
        (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0],
      ).pid;
      await blocker.query('SELECT task_id FROM task_execution.task WHERE task_id=$1 FOR UPDATE', [
        scenarioState.taskId,
      ]);
      const waiting = async () =>
        definedValue(
          (
            await scenarioState.admin.query<{ n: number }>(
              'WITH RECURSIVE blocked AS (SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))) SELECT count(*)::int n FROM blocked',
              [pid],
            )
          ).rows[0],
        ).n;
      child = scenarioState.createWorkOrderResult({
        taskId: scenarioState.taskId,
        taskMajor: '2.0',
        customDraft: structuredClone(scenarioState.draft),
      });
      await expect.poll(waiting, { timeout: 10000 }).toBeGreaterThan(0);
      completion = Promise.allSettled([
        scenarioState.formalEntry.evaluateTask(
          taskEnvelope,
          scenarioState.sessionFor(scenarioState.service),
        ),
      ]).then((r) => definedValue(r[0]));
      await expect.poll(waiting, { timeout: 10000 }).toBeGreaterThan(1);
      await blocker.query('ROLLBACK');
      expect(await child).toMatchObject({ result: { status: 'COMMITTED' } });
      const result = await completion;
      expect(result).toMatchObject({ status: 'rejected', reason: { code: 'NOT_FOUND' } });
      if (!('commandId' in taskEnvelope)) throw new Error('Expected Completion command');
      expect(await scenarioState.receiptRows(String(taskEnvelope.idempotencyKey))).toEqual([]);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT evaluation_id FROM task_execution.completion_evaluation WHERE source_command_id=$1',
            [taskEnvelope.commandId],
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT count(*)::int n FROM task_execution.work_order WHERE task_id=$1',
            [scenarioState.taskId],
          )
        ).rows,
      ).toEqual([{ n: 2 }]);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT status FROM task_execution.task WHERE task_id=$1',
            [scenarioState.taskId],
          )
        ).rows,
      ).toEqual([{ status: 'COMPLETION_PENDING' }]);
      expect(
        (
          await scenarioState.admin.query(
            "SELECT count(*)::int n FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.TaskCompleted'",
            [scenarioState.taskId],
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
      await Promise.allSettled([...(child ? [child] : []), ...(completion ? [completion] : [])]);
    }
    return;
  }
  if (
    scenarioState.terminalScenario === 'FORMAL_GRANT_LOCK' ||
    scenarioState.terminalScenario === 'FORMAL_DEPENDENCY_LOCK'
  ) {
    const blocker = new pg.Client({ connectionString: scenarioState.activeDatabaseUrl });
    await blocker.connect();
    let pending:
      | Promise<
          PromiseSettledResult<Awaited<ReturnType<typeof scenarioState.formalEntry.evaluateTask>>>
        >
      | undefined;
    try {
      await blocker.query('BEGIN');
      const pid = definedValue(
        (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0],
      ).pid;
      await blocker.query('SELECT task_id FROM task_execution.task WHERE task_id=$1 FOR UPDATE', [
        scenarioState.taskId,
      ]);
      pending = Promise.allSettled([
        scenarioState.formalEntry.evaluateTask(
          taskEnvelope,
          scenarioState.sessionFor(scenarioState.service),
        ),
      ]).then((r) => definedValue(r[0]));
      await expect
        .poll(
          async () =>
            definedValue(
              (
                await scenarioState.admin.query<{ n: number }>(
                  'SELECT count(*)::int n FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',
                  [pid],
                )
              ).rows[0],
            ).n,
          { timeout: 10000 },
        )
        .toBeGreaterThan(0);
      const key =
        scenarioState.terminalScenario === 'FORMAL_GRANT_LOCK'
          ? 'taskCompletionEvaluateV2'
          : 'taskCompletionCompletionSourcesReadV1';
      expect(
        await scenarioState.revokeCapabilityTracked(
          scenarioState.identityDeps([scenarioState.fixture.projectId]),
          {
            targetId: definedValue(scenarioState.formalGrants.get(key)),
            expectedAggregateVersion: '1',
            scope: {
              scopeKind: 'PROJECT',
              enterpriseId: scenarioState.fixture.enterpriseId,
              projectId: scenarioState.fixture.projectId,
            },
            reasonCode: 'FORMAL_LOCKED_AUTHORITY_REVOKED',
            effectiveAt: new Date(scenarioState.clock),
            idempotencyKey: newUuidV7(),
          },
        ),
      ).toMatchObject({ status: 'COMMITTED' });
      await blocker.query('ROLLBACK');
      expect(await pending).toMatchObject({
        status: 'rejected',
        reason: { code: 'AUTHORIZATION_DECISION_INVALID' },
      });
      if (!('commandId' in taskEnvelope)) throw new Error('Expected Completion command');
      expect(await scenarioState.receiptRows(String(taskEnvelope.idempotencyKey))).toEqual([]);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT evaluation_id FROM task_execution.completion_evaluation WHERE source_command_id=$1',
            [taskEnvelope.commandId],
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT status,aggregate_version,current_completion_evaluation_id FROM task_execution.task WHERE task_id=$1',
            [scenarioState.taskId],
          )
        ).rows,
      ).toEqual([
        {
          status: 'COMPLETION_PENDING',
          aggregate_version: String(taskVersion),
          current_completion_evaluation_id: null,
        },
      ]);
      expect(
        (
          await scenarioState.admin.query(
            "SELECT count(*)::int n FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.TaskCompleted'",
            [scenarioState.taskId],
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
      if (pending) await Promise.allSettled([pending]);
    }
    return;
  }
  if (scenarioState.deliverySchedule) {
    scenarioState.deliverySchedule.onPrepared({
      plan: definedValue(scenarioState.deliveryPlan),
      taskId: scenarioState.taskId,
      complete: () =>
        scenarioState.formalEntry.evaluateTask(
          taskEnvelope,
          scenarioState.sessionFor(scenarioState.service),
        ),
    });
    return;
  }
  let taskResult: Awaited<ReturnType<typeof scenarioState.formalEntry.evaluateTask>>;
  if (scenarioState.terminalScenario === 'FORMAL_NORMAL') {
    const blocker = new pg.Client({ connectionString: scenarioState.activeDatabaseUrl });
    await blocker.connect();
    let completion:
      Promise<Awaited<ReturnType<typeof scenarioState.formalEntry.evaluateTask>>> | undefined;
    let child: ReturnType<typeof scenarioState.createWorkOrderResult> | undefined;
    try {
      await blocker.query('BEGIN');
      const pid = definedValue(
        (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0],
      ).pid;
      await blocker.query('SELECT task_id FROM task_execution.task WHERE task_id=$1 FOR UPDATE', [
        scenarioState.taskId,
      ]);
      completion = scenarioState.track(
        scenarioState.formalEntry.evaluateTask(
          taskEnvelope,
          scenarioState.sessionFor(scenarioState.service),
        ),
      );
      const waiting = async () =>
        (
          await scenarioState.admin.query<{ n: number }>(
            'WITH RECURSIVE blocked AS (SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))) SELECT count(*)::int n FROM blocked',
            [pid],
          )
        ).rows[0]?.n ?? 0;
      await expect.poll(waiting, { timeout: 10000 }).toBeGreaterThan(0);
      // This is a distinct owning Command/connection, queued behind Completion.
      child = scenarioState.createWorkOrderResult({
        taskId: scenarioState.taskId,
        taskMajor: '2.0',
        customDraft: structuredClone(scenarioState.draft),
      });
      let earlyChild: unknown;
      const childSettled = child.then(
        (value) => {
          earlyChild = value;
          return { value };
        },
        (error: unknown) => {
          earlyChild = error;
          return { error };
        },
      );
      await expect
        .poll(
          async () => {
            if (earlyChild !== undefined)
              throw new Error(
                `Child failed before lock competition: ${JSON.stringify(earlyChild)}`,
              );
            return waiting();
          },
          { timeout: 10000 },
        )
        .toBeGreaterThan(1);
      await blocker.query('ROLLBACK');
      taskResult = await completion;
      const rejected = await childSettled;
      expect(
        'error' in rejected || ('value' in rejected && rejected.value.result.status === 'REJECTED'),
      ).toBe(true);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT count(*)::int n FROM task_execution.work_order WHERE task_id=$1',
            [scenarioState.taskId],
          )
        ).rows,
      ).toEqual([{ n: 1 }]);
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
      if (completion) await Promise.allSettled([completion]);
      if (child) await Promise.allSettled([child]);
    }
  } else
    taskResult = await scenarioState.formalEntry.evaluateTask(
      taskEnvelope,
      scenarioState.sessionFor(scenarioState.service),
    );
  expect(taskResult, JSON.stringify(taskResult)).toMatchObject({
    status: 'COMMITTED',
    resultPayload: { outcome: 'SATISFIED', transitioned: true },
  });
  if (scenarioState.delivery)
    await scenarioState.verifyDeliveryTail(
      definedValue(scenarioState.deliveryPlan),
      scenarioState.taskId,
      scenarioState.service,
      scenarioState.deliveryRequiredRelease,
    );
  for (const result of [woResult, taskResult]) {
    const judgmentRef = scenarioState.committedPayload(result)
      .evaluationRef as unknown as Common.ContentAddressedRef;
    const current = await scenarioState.formalEntry.readJudgment(
      await scenarioState.formalEnvelope(
        'completionJudgmentReadV1',
        judgmentRef,
        { judgmentRef } as unknown as CanonicalJsonObject,
        scenarioState.service,
        undefined,
        true,
      ),
      scenarioState.sessionFor(scenarioState.service),
    );
    expect(current).toMatchObject({
      useStatus: 'USABLE',
      evaluation: { outcome: 'SATISFIED', completionTransition: true },
    });
  }
  const state = await scenarioState.formalEntry.readWorkOrder(
    await scenarioState.formalEnvelope(
      'workOrderStateReadV1',
      scenarioState.workOrderRef,
      { workOrderRef: scenarioState.workOrderRef } as unknown as CanonicalJsonObject,
      scenarioState.service,
      undefined,
      true,
    ),
    scenarioState.sessionFor(scenarioState.service),
  );
  expect(state).toMatchObject({
    status: definedValue(scenarioState.formalFixture).expected.workOrderStatus,
    completionUseStatus: definedValue(scenarioState.formalFixture).expected.completionUseStatus,
  });
  expect(
    (
      await scenarioState.admin.query(
        'SELECT count(*)::int n FROM task_execution.run WHERE work_order_id=$1',
        [scenarioState.woId],
      )
    ).rows,
  ).toEqual([{ n: definedValue(scenarioState.formalFixture).expected.runCount }]);
  const dependent = await scenarioState.createExecutableTask(
    '2.0',
    true,
    { dependencyTaskRefs: [scenarioState.revised.taskRef] },
    true,
  );
  await scenarioState.readyTaskForValidation(dependent, scenarioState.formalConfig);
  expect(
    (
      await scenarioState.admin.query('SELECT status FROM task_execution.task WHERE task_id=$1', [
        dependent,
      ])
    ).rows,
  ).toEqual([{ status: 'READY' }]);
  if (scenarioState.terminalScenario === 'FORMAL_NORMAL') {
    scenarioState.phase('formal completion: judgment freshness and withdrawal');
    async function exact(result: unknown) {
      const judgmentRef = record(record(result).resultPayload)
        .evaluationRef as Common.ContentAddressedRef;
      return scenarioState.formalEntry.readJudgment(
        await scenarioState.formalEnvelope(
          'completionJudgmentReadV1',
          judgmentRef,
          { judgmentRef } as unknown as CanonicalJsonObject,
          scenarioState.service,
          undefined,
          true,
        ),
        scenarioState.sessionFor(scenarioState.service),
      );
    }
    const historicalWo = await exact(woResult);
    const firstPointers = (
      await scenarioState.admin.query(
        'SELECT first_completion_evaluation_id,first_completion_evaluation_hash,completed_at FROM task_execution.work_order WHERE work_order_id=$1',
        [scenarioState.woId],
      )
    ).rows;
    const refreshEnvelope = await scenarioState.formalEnvelope(
      'workOrderCompletionEvaluateV2',
      scenarioState.workOrderRef,
      payload,
      scenarioState.service,
      woVersion + 1,
    );
    if (!('idempotencyKey' in refreshEnvelope)) throw new Error('Expected refresh command');
    const refreshed = await Promise.all([
      scenarioState.formalEntry.evaluateWorkOrder(
        refreshEnvelope,
        scenarioState.sessionFor(scenarioState.service),
      ),
      scenarioState.formalEntry.evaluateWorkOrder(
        refreshEnvelope,
        scenarioState.sessionFor(scenarioState.service),
      ),
    ]);
    expect(refreshed.map((r) => r.status).sort()).toEqual(['COMMITTED', 'DUPLICATE']);
    const refreshResult = definedValue(refreshed.find((r) => r.status === 'COMMITTED'));
    expect(refreshResult.resultPayload).toMatchObject({
      outcome: 'SATISFIED',
      transitioned: false,
    });
    expect(await exact(refreshResult)).toMatchObject({
      useStatus: 'USABLE',
      evaluation: { completionTransition: false },
    });
    expect(await exact(woResult)).toMatchObject({
      useStatus: 'STALE',
      evaluation: historicalWo.evaluation,
    });
    expect(
      (
        await scenarioState.admin.query(
          'SELECT first_completion_evaluation_id,first_completion_evaluation_hash,completed_at FROM task_execution.work_order WHERE work_order_id=$1',
          [scenarioState.woId],
        )
      ).rows,
    ).toEqual(firstPointers);
    expect(await exact(taskResult)).toMatchObject({ useStatus: 'STALE' });
    const oldCas = await scenarioState.formalEnvelope(
      'workOrderCompletionEvaluateV2',
      scenarioState.workOrderRef,
      payload,
      scenarioState.service,
      woVersion,
    );
    await expect(
      scenarioState.formalEntry.evaluateWorkOrder(
        oldCas,
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).rejects.toMatchObject({ code: 'AGGREGATE_VERSION_CONFLICT' });
    const conflictPayload = {
      ...payload,
      policyRef: policyKey([newUuidV7(), newUuidV7()], scenarioState.fixture),
    } as unknown as CanonicalJsonObject;
    const conflict = await scenarioState.formalEnvelope(
      'workOrderCompletionEvaluateV2',
      scenarioState.workOrderRef,
      conflictPayload,
      scenarioState.service,
      woVersion + 1,
    );
    await expect(
      scenarioState.formalEntry.evaluateWorkOrder(
        { ...conflict, idempotencyKey: refreshEnvelope.idempotencyKey },
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_CONFLICT' });
    for (const action of ['UPDATE', 'DELETE']) {
      await expect(
        withTaskExecutionTransaction(
          scenarioState.teDb,
          scenarioState.runnerContext(scenarioState.service),
          (trx) =>
            sql
              .raw(
                action === 'UPDATE'
                  ? `UPDATE task_execution.completion_evaluation SET canonical_payload=canonical_payload WHERE target_id='${scenarioState.woId}'::uuid`
                  : `DELETE FROM task_execution.completion_evaluation WHERE target_id='${scenarioState.woId}'::uuid`,
              )
              .execute(trx),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
    const sourceKey = 'workOrderCompletionCompletionSourcesReadV1';
    const revoke = async (key: string) => {
      expect(
        await scenarioState.revokeCapabilityTracked(
          scenarioState.identityDeps([scenarioState.fixture.projectId]),
          {
            targetId: definedValue(scenarioState.formalGrants.get(key)),
            expectedAggregateVersion: '1',
            scope: {
              scopeKind: 'PROJECT',
              enterpriseId: scenarioState.fixture.enterpriseId,
              projectId: scenarioState.fixture.projectId,
            },
            reasonCode: 'FORMAL_COMPLETION_REVOKE',
            effectiveAt: new Date(scenarioState.clock),
            idempotencyKey: newUuidV7(),
          },
        ),
      ).toMatchObject({ status: 'COMMITTED' });
    };
    await revoke(sourceKey);
    // Historical replay requires its current own authority, not a new source read.
    expect(
      await scenarioState.formalEntry.evaluateWorkOrder(
        refreshEnvelope,
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({ status: 'DUPLICATE', resultPayload: refreshResult.resultPayload });
    const missingSource = await scenarioState.formalEnvelope(
      'workOrderCompletionEvaluateV2',
      scenarioState.workOrderRef,
      payload,
      scenarioState.service,
      woVersion + 2,
    );
    await expect(
      scenarioState.formalEntry.evaluateWorkOrder(
        missingSource,
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DECISION_INVALID' });
    const binding = definedValue(
      formalCompletionBindings().find((b) => b.capabilityConfigKey === sourceKey),
    );
    await scenarioState.grant({
      principal: scenarioState.service,
      capabilityCode: definedValue(scenarioState.formalCodes[sourceKey]),
      action: binding.requiredGrantAction,
      selectorType: binding.selectorType,
      targetObjectType: definedValue(binding.targetObjectTypes[0]),
    });
    await revoke('workOrderCompletionEvaluateV2');
    await expect(
      scenarioState.formalEntry.evaluateWorkOrder(
        refreshEnvelope,
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DECISION_INVALID' });
    const taskRefresh = await scenarioState.formalEntry.evaluateTask(
      await scenarioState.formalEnvelope(
        'taskCompletionEvaluateV2',
        scenarioState.revised.taskRef as Common.ObjectRef,
        {
          ...payload,
          evaluatorRef: registeredEvaluatorProfileReference(
            'im06-evaluator-static-v1',
            'te.task_completion.evaluator@1.0',
          ),
        } as unknown as CanonicalJsonObject,
        scenarioState.service,
        taskVersion + 1,
      ),
      scenarioState.sessionFor(scenarioState.service),
    );
    expect(await exact(taskRefresh)).toMatchObject({ useStatus: 'USABLE' });
    const dependentDuringWithdrawal = await scenarioState.createExecutableTask(
      '2.0',
      true,
      { dependencyTaskRefs: [scenarioState.revised.taskRef] },
      true,
    );
    await scenarioState.readyTaskForValidation(
      dependentDuringWithdrawal,
      scenarioState.formalConfig,
      async () => {
        const revisionRef = record(
          definedValue(scenarioState.actualFormalOutput).ref,
        ) as unknown as Common.ContentAddressedRef;
        const context = scenarioState.runnerContext();
        const withdrawal = {
          withdrawalReason: {
            reasonCode: 'FORMAL_OUTPUT_WITHDRAWN',
            summary: 'Actual owning withdrawal between Readiness build and mark.',
            evidenceRefs: [],
          },
        } as unknown as CanonicalJsonObject;
        expect(
          await handleWithdrawRevision(scenarioState.artifactDb, context, {
            commandId: newUuidV7(),
            commandType: 'artifact.withdraw_revision',
            commandVersion: '1.0',
            idempotencyScope: 'formal.withdrawal',
            idempotencyKey: newUuidV7(),
            requestPayload: withdrawal,
            payload: withdrawal,
            enterpriseId: scenarioState.fixture.enterpriseId,
            projectId: scenarioState.fixture.projectId,
            targetType: 'ArtifactRevision',
            targetId: revisionRef.objectId,
            correlationId: CORRELATION,
            principalId: OPERATOR,
            principalKind: 'HUMAN',
            actorSnapshotId: OPERATOR_ACTOR,
            authorizationDecisionId: REQUEST_DECISION,
            policySnapshotId: POLICY_SNAPSHOT_ID,
          } as unknown as Parameters<typeof handleWithdrawRevision>[2]),
        ).toMatchObject({ status: 'COMMITTED' });
      },
    );
    expect(await exact(refreshResult)).toMatchObject({ useStatus: 'REVOKED' });
    expect(await exact(taskRefresh)).toMatchObject({ useStatus: 'REVOKED' });
    const dependentAfterWithdrawal = await scenarioState.createExecutableTask(
      '2.0',
      true,
      { dependencyTaskRefs: [scenarioState.revised.taskRef] },
      true,
    );
    await scenarioState.readyTaskForValidation(
      dependentAfterWithdrawal,
      scenarioState.formalConfig,
      undefined,
      true,
    );
  }
  if (
    scenarioState.terminalScenario === 'FORMAL_POLICY' ||
    scenarioState.terminalScenario === 'FORMAL_TTL'
  ) {
    const judgmentRef = scenarioState.committedPayload(woResult)
      .evaluationRef as unknown as Common.ContentAddressedRef;
    const read = async () =>
      scenarioState.formalEntry.readJudgment(
        await scenarioState.formalEnvelope(
          'completionJudgmentReadV1',
          judgmentRef,
          { judgmentRef } as unknown as CanonicalJsonObject,
          scenarioState.service,
          undefined,
          true,
        ),
        scenarioState.sessionFor(scenarioState.service),
      );
    const before = await read();
    expect(before.useStatus).toBe('USABLE');
    const firstFacts = (
      await scenarioState.admin.query(
        'SELECT first_completion_evaluation_id,first_completion_evaluation_hash,completed_at FROM task_execution.work_order WHERE work_order_id=$1',
        [scenarioState.woId],
      )
    ).rows;
    if (scenarioState.terminalScenario === 'FORMAL_POLICY') {
      await scenarioState.registerPolicyVersionAs({
        key: { ...scenarioState.completionRef, versionId: newUuidV7() },
        factId: newUuidV7(),
        idempotencyKey: newUuidV7(),
        effectiveFrom: new Date(scenarioState.clock),
        supersedesRef: scenarioState.completionRef,
        policySchemaRefs: [profileReference('execution.completion.policy@1.0')],
        policyDocument: { maxCompletionValiditySeconds: 600 },
      });
    } else {
      const lease = definedValue(
        (
          await scenarioState.admin.query<{ lease_expires_at: Date }>(
            'SELECT lease_expires_at FROM task_execution.run WHERE run_id=$1',
            [scenarioState.runRef.objectId],
          )
        ).rows[0],
      ).lease_expires_at;
      scenarioState.clock = lease.getTime() + 1;
      expect(scenarioState.clock).toBeLessThan(Date.parse(before.evaluation.validUntil as string));
      expect(await read()).toMatchObject({
        useStatus: 'USABLE',
        evaluation: before.evaluation,
      });
      const until = before.evaluation.validUntil;
      if (typeof until !== 'string') throw new Error('Missing Evaluation expiry');
      scenarioState.clock = new Date(until).getTime() + 1;
    }
    expect(await read()).toMatchObject({ useStatus: 'STALE', evaluation: before.evaluation });
    if (scenarioState.terminalScenario === 'FORMAL_TTL') {
      const refreshed = await scenarioState.formalEntry.evaluateWorkOrder(
        await scenarioState.formalEnvelope(
          'workOrderCompletionEvaluateV2',
          scenarioState.workOrderRef,
          payload,
          scenarioState.service,
          woVersion + 1,
        ),
        scenarioState.sessionFor(scenarioState.service),
      );
      expect(refreshed).toMatchObject({
        status: 'COMMITTED',
        resultPayload: { outcome: 'SATISFIED', transitioned: false },
      });
      const newRef = scenarioState.committedPayload(refreshed)
        .evaluationRef as unknown as Common.ContentAddressedRef;
      expect(
        await scenarioState.formalEntry.readJudgment(
          await scenarioState.formalEnvelope(
            'completionJudgmentReadV1',
            newRef,
            { judgmentRef: newRef } as unknown as CanonicalJsonObject,
            scenarioState.service,
            undefined,
            true,
          ),
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).toMatchObject({ useStatus: 'USABLE' });
    }
    expect(
      (
        await scenarioState.admin.query(
          'SELECT first_completion_evaluation_id,first_completion_evaluation_hash,completed_at FROM task_execution.work_order WHERE work_order_id=$1',
          [scenarioState.woId],
        )
      ).rows,
    ).toEqual(firstFacts);
  }
  if (scenarioState.qualityProfile) {
    const judgmentRef = scenarioState.committedPayload(taskResult)
      .evaluationRef as unknown as Common.ContentAddressedRef;
    async function query(ref: Common.ContentAddressedRef) {
      return scenarioState.formalEntry.readJudgment(
        await scenarioState.formalEnvelope(
          'completionJudgmentReadV1',
          ref,
          { judgmentRef: ref } as unknown as CanonicalJsonObject,
          scenarioState.service,
          undefined,
          true,
        ),
        scenarioState.sessionFor(scenarioState.service),
      );
    }
    const before = await query(judgmentRef);
    expect(before.useStatus).toBe('USABLE');
    expect(record(before.evaluation.qualitySelection).qualityProfileRef).toEqual(
      scenarioState.qualityProfile.profileRef,
    );
    const selectionKey = 'taskCompletionCompletionQualitySelectionReadV1';
    expect(
      await scenarioState.revokeCapabilityTracked(
        scenarioState.identityDeps([scenarioState.fixture.projectId]),
        {
          targetId: definedValue(scenarioState.formalGrants.get(selectionKey)),
          expectedAggregateVersion: '1',
          scope: {
            scopeKind: 'PROJECT',
            enterpriseId: scenarioState.fixture.enterpriseId,
            projectId: scenarioState.fixture.projectId,
          },
          reasonCode: 'FORMAL_QUALITY_SELECTION_REVOKED',
          effectiveAt: new Date(scenarioState.clock),
          idempotencyKey: newUuidV7(),
        },
      ),
    ).toMatchObject({ status: 'COMMITTED' });
    await expect(
      scenarioState.formalEntry.evaluateTask(
        await scenarioState.formalEnvelope(
          'taskCompletionEvaluateV2',
          scenarioState.revised.taskRef as Common.ObjectRef,
          {
            ...payload,
            evaluatorRef: registeredEvaluatorProfileReference(
              'im06-evaluator-static-v1',
              'te.task_completion.evaluator@1.0',
            ),
          } as unknown as CanonicalJsonObject,
          scenarioState.service,
          taskVersion + 1,
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DECISION_INVALID' });
    const selectionBinding = definedValue(
      formalCompletionBindings().find((b) => b.capabilityConfigKey === selectionKey),
    );
    await scenarioState.grant({
      principal: scenarioState.service,
      capabilityCode: definedValue(scenarioState.formalCodes[selectionKey]),
      action: selectionBinding.requiredGrantAction,
      selectorType: selectionBinding.selectorType,
      targetObjectType: definedValue(selectionBinding.targetObjectTypes[0]),
    });
    expect((await query(judgmentRef)).useStatus).toBe('USABLE');
    const newer = await scenarioState.quality.accept(
      scenarioState.qualityProfile,
      definedValue(scenarioState.actualFormalArtifact),
      record(
        definedValue(scenarioState.actualFormalOutput).ref,
      ) as unknown as Common.ContentAddressedRef,
      2,
    );
    const newerApproval = await scenarioState.quality.approve(
      scenarioState.qualityProfile,
      definedValue(scenarioState.actualFormalArtifact),
      record(
        definedValue(scenarioState.actualFormalOutput).ref,
      ) as unknown as Common.ContentAddressedRef,
      newer.acceptanceRef,
      scenarioState.runnerContext(scenarioState.other()),
    );
    const superseded = await query(judgmentRef);
    expect(superseded.useStatus).toBe('STALE');
    expect(superseded.evaluation).toEqual(before.evaluation);
    const refresh = await scenarioState.formalEntry.evaluateTask(
      await scenarioState.formalEnvelope(
        'taskCompletionEvaluateV2',
        scenarioState.revised.taskRef as Common.ObjectRef,
        {
          ...payload,
          evaluatorRef: registeredEvaluatorProfileReference(
            'im06-evaluator-static-v1',
            'te.task_completion.evaluator@1.0',
          ),
        } as unknown as CanonicalJsonObject,
        scenarioState.service,
        taskVersion + 1,
      ),
      scenarioState.sessionFor(scenarioState.service),
    );
    expect(refresh).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { outcome: 'SATISFIED', transitioned: false },
    });
    const newRef = scenarioState.committedPayload(refresh)
      .evaluationRef as unknown as Common.ContentAddressedRef;
    const refreshed = await query(newRef);
    expect(refreshed.useStatus).toBe('USABLE');
    expect(record(refreshed.evaluation.qualitySelection).outputSnapshots).not.toEqual(
      record(before.evaluation.qualitySelection).outputSnapshots,
    );
    expect(await scenarioState.quality.revoke(newerApproval.approvalRef)).toMatchObject({
      status: 'COMMITTED',
    });
    expect(await query(newRef)).toMatchObject({
      useStatus: 'REVOKED',
      evaluation: refreshed.evaluation,
    });
    expect(await scenarioState.quality.invalidate(newer.gateRef)).toMatchObject({
      status: 'COMMITTED',
    });
    expect(await query(newRef)).toMatchObject({
      useStatus: 'REVOKED',
      evaluation: refreshed.evaluation,
    });
    await scenarioState.quality.supersedeProfile(scenarioState.qualityProfile.profileRef);
    expect((await query(newRef)).useStatus).not.toBe('USABLE');
  }

  expect(
    (
      await scenarioState.admin.query('SELECT status FROM task_execution.task WHERE task_id=$1', [
        scenarioState.taskId,
      ])
    ).rows,
  ).toEqual([{ status: 'COMPLETED' }]);
  expect(
    (
      await scenarioState.admin.query<{ aggregate_id: string; n: number }>(
        "SELECT aggregate_id,count(*)::int n FROM task_execution.outbox_event WHERE aggregate_id=ANY($1::uuid[]) AND event_type IN('execution.WorkOrderCompleted','execution.TaskCompleted') GROUP BY aggregate_id",
        [[scenarioState.woId, scenarioState.taskId]],
      )
    ).rows.map((r) => r.n),
  ).toEqual([
    definedValue(scenarioState.formalFixture).expected.completedEventsPerRoot,
    definedValue(scenarioState.formalFixture).expected.completedEventsPerRoot,
  ]);
}
