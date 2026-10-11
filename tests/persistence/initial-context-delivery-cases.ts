import { type CanonicalJsonObject, newUuidV7 } from '@zhiju/shared-kernel';
import type { KyselyPlugin } from 'kysely';
import { expect } from 'vitest';
import {
  definedValue,
  type DeliveryScheduleHooks,
  type PreparedDeliverySource,
} from './initial-context-fixtures.js';
import type { IsolatedInitialContextCase } from './initial-context-isolated-cases.js';

export function deliveryCases(): IsolatedInitialContextCase[] {
  const cases: IsolatedInitialContextCase[] = [];
  function registerCase(
    name: string,
    run: IsolatedInitialContextCase['run'],
    timeout: number,
  ): void {
    cases.push({ name, run, timeout });
  }
  registerCase(
    'TE-DEL-D-004/EP-DEL-D-004 isolated late-commit and cross-Item out-of-order schedule',
    async (suite, runScenario) => {
      let releaseProducer!: () => void;
      const held = new Promise<void>((resolve) => {
        releaseProducer = resolve;
      });
      let producerWriteObserved = false;
      let heldQueryId: Parameters<KyselyPlugin['transformQuery']>[0]['queryId'] | undefined;
      const pauseAfterEventInsert: KyselyPlugin = {
        transformQuery(args) {
          if (
            args.node.kind === 'InsertQueryNode' &&
            JSON.stringify(args.node).includes('execution.TaskCompleted')
          )
            heldQueryId = args.queryId;
          return args.node;
        },
        async transformResult(args) {
          if (args.queryId === heldQueryId) {
            producerWriteObserved = true;
            // Pause the actual producer after its Outbox INSERT, before
            // its owning transaction can commit. No source row is seeded.
            await held;
          }
          return args.result;
        },
      };
      let pendingCompletion: ReturnType<PreparedDeliverySource['complete']> | undefined;
      try {
        let lateSource: PreparedDeliverySource | undefined;
        let visibleSource: PreparedDeliverySource | undefined;
        const prepare = (hooks: DeliveryScheduleHooks) =>
          runScenario(
            'FORMAL_DELIVERY_NORMAL',
            'RUNTIME_USAGE',
            undefined,
            undefined,
            undefined,
            undefined,
            'NORMAL',
            false,
            hooks,
          );
        const visibleTaskId = newUuidV7();
        await prepare({
          completionPlugin: pauseAfterEventInsert,
          additionalTaskIds: [visibleTaskId],
          onPrepared: (source) => {
            lateSource = source;
          },
        });
        const first = definedValue(lateSource);
        const secondItem = definedValue(first.plan.additionalItems[0]);
        await prepare({
          taskId: visibleTaskId,
          plan: { ...first.plan, ...secondItem },
          onPrepared: (source) => {
            visibleSource = source;
          },
        });
        const late = definedValue(lateSource),
          visible = definedValue(visibleSource);
        expect(late.taskId).not.toBe(visible.taskId);
        expect(late.plan.deliveryItemRef).not.toEqual(visible.plan.deliveryItemRef);
        expect(late.plan.deliveryPlanRef).toEqual(visible.plan.deliveryPlanRef);
        const { entry, roles, session, projectRef } = await suite.deliveryTestEntries(late.taskId);
        pendingCompletion = suite.track(late.complete());
        await expect.poll(() => producerWriteObserved, { timeout: 30_000 }).toBe(true);
        expect(
          (
            await suite.admin.query(
              "SELECT count(*)::int n FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.TaskCompleted'",
              [late.taskId],
            )
          ).rows,
        ).toEqual([{ n: 0 }]);
        expect(await entry.scan(projectRef, session(roles.dispatcher))).toEqual([]);
        expect(await visible.complete()).toMatchObject({
          status: 'COMMITTED',
          resultPayload: { outcome: 'SATISFIED', transitioned: true },
        });
        const eventFor = async (taskId: string) =>
          definedValue(
            (
              await suite.admin.query<{ event_id: string }>(
                "SELECT event_id FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.TaskCompleted'",
                [taskId],
              )
            ).rows[0],
          ).event_id;
        const visibleEvent = await eventFor(visible.taskId);
        expect(await entry.scan(projectRef, session(roles.dispatcher))).toEqual([visibleEvent]);
        const visibleClaim = await entry.claim(projectRef, visibleEvent, session(roles.dispatcher));
        if (visibleClaim.status !== 'CLAIMED') throw new Error('Visible source was not claimed');
        const visibleMaterial = await entry.readClaimed(visibleClaim, session(roles.dispatcher));
        expect(visibleMaterial.sourceWatermark.sequence).toBe(1);
        releaseProducer();
        expect(await pendingCompletion).toMatchObject({
          status: 'COMMITTED',
          resultPayload: { outcome: 'SATISFIED', transitioned: true },
        });
        const lateEvent = await eventFor(late.taskId);
        expect(lateEvent < visibleEvent, 'The lower UUID sort key really committed later').toBe(
          true,
        );
        expect(await entry.scan(projectRef, session(roles.dispatcher))).toContain(lateEvent);
        const lateClaim = await entry.claim(projectRef, lateEvent, session(roles.dispatcher));
        if (lateClaim.status !== 'CLAIMED') throw new Error('Late source was not discovered');
        const lateMaterial = await entry.readClaimed(lateClaim, session(roles.dispatcher));
        expect(lateMaterial.sourceWatermark.sequence).toBe(2);
        for (const material of [lateMaterial, visibleMaterial])
          expect(material.sourceWatermark).toMatchObject({
            sourceModule: 'task_execution',
            partition: suite.fixture.projectId,
          });
        const bindingsBefore = (
          await suite.admin.query(
            'SELECT * FROM task_execution.task_completed_dispatch_binding ORDER BY event_id',
          )
        ).rows;
        expect(bindingsBefore).toHaveLength(2);
        // Deliver and evaluate the higher allocation first. The subsequent
        // lower allocation belongs to a different exact Item and stays usable.
        for (const [source, claim, material] of [
          [late, lateClaim, lateMaterial],
          [visible, visibleClaim, visibleMaterial],
        ] as const) {
          expect(await entry.readClaimed(claim, session(roles.dispatcher))).toEqual(material);
          const consumed = await entry.consume(material, session(roles.consumer));
          if (consumed.status !== 'PROCESSED') throw new Error('Expected owning consumption');
          expect(await entry.consume(material, session(roles.consumer))).toMatchObject({
            status: 'DUPLICATE',
            factRef: consumed.factRef,
          });
          await entry.confirm(
            claim,
            material,
            consumed as unknown as CanonicalJsonObject,
            session(roles.dispatcher),
          );
          const request = {
            deliveryPlanRef: source.plan.deliveryPlanRef,
            deliveryItemRef: source.plan.deliveryItemRef,
            factRefs: [consumed.factRef],
          };
          const evaluated = await entry.evaluate(
            { payload: request, expectedAggregateVersion: 1, idempotencyKey: newUuidV7() },
            session(roles.evaluator),
          );
          expect(evaluated).toMatchObject({
            status: 'COMMITTED',
            resultPayload: { outcome: 'SATISFIED', aggregateVersion: 2 },
          });
          const readback = await entry.readExact(request, session(roles.reader));
          expect(readback).toMatchObject({
            derivedStatus: 'SATISFIED',
            completionAggregateVersion: 2,
            selectedEvaluationIsCurrent: true,
          });
          expect(readback.facts[0]).toMatchObject({
            taskRef: material.sidecar.taskRef,
            deliveryItemRef: source.plan.deliveryItemRef,
            sourceWatermark: material.sourceWatermark,
            bindingHash: material.bindingHash,
          });
          expect(
            (
              await suite.admin.query(
                `SELECT
                    (SELECT count(*)::int FROM enterprise_project.delivery_item_completion_fact WHERE event_id=$1) facts,
                    (SELECT count(*)::int FROM enterprise_project.delivery_completion_task_association WHERE event_id=$1) associations,
                    (SELECT count(*)::int FROM enterprise_project.delivery_item_completion_evaluation WHERE delivery_item_id=$2) evaluations,
                    (SELECT count(*)::int FROM enterprise_project.outbox_event WHERE aggregate_id=$2 AND event_type='project.DeliveryItemCompletionSatisfied') events`,
                [claim.eventId, source.plan.deliveryItemRef.objectId],
              )
            ).rows,
          ).toEqual([{ facts: 1, associations: 1, evaluations: 1, events: 1 }]);
          if (source === late)
            expect(
              (
                await suite.admin.query(
                  'SELECT count(*)::int n FROM enterprise_project.delivery_item_completion_fact WHERE event_id=$1',
                  [visibleEvent],
                )
              ).rows,
            ).toEqual([{ n: 0 }]);
        }
        expect(
          (
            await suite.admin.query(
              'SELECT * FROM task_execution.task_completed_dispatch_binding ORDER BY event_id',
            )
          ).rows,
        ).toEqual(bindingsBefore);
        expect(
          (
            await suite.admin.query(
              'SELECT completion_aggregate_version::int v FROM enterprise_project.delivery_item WHERE delivery_item_id=ANY($1::uuid[]) ORDER BY delivery_item_id',
              [[late.plan.deliveryItemRef.objectId, visible.plan.deliveryItemRef.objectId]],
            )
          ).rows,
        ).toEqual([{ v: 2 }, { v: 2 }]);
      } finally {
        releaseProducer();
        if (pendingCompletion) await Promise.allSettled([pendingCompletion]);
      }
    },
    600_000,
  );
  for (const recovered of [false, true])
    registerCase(
      `TE-DEL-D-001/002/003 isolated ${recovered ? 'recovered' : 'normal'} owning delivery fixture`,
      async (suite, runScenario) => {
        expect(
          (await suite.admin.query('SELECT count(*)::int n FROM task_execution.task')).rows,
        ).toEqual([{ n: 0 }]);
        const scenario = recovered ? 'FORMAL_DELIVERY_RECOVERED' : 'FORMAL_DELIVERY_NORMAL';
        await runScenario(scenario);
        await runScenario(
          scenario,
          'RUNTIME_USAGE',
          undefined,
          undefined,
          undefined,
          undefined,
          'NORMAL',
          true,
        );
      },
      600_000,
    );
  return cases;
}
