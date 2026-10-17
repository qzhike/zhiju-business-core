import { digestCanonicalPayload } from '@zhiju/task-execution';
import { createTaskCompletedDeliveryEntry } from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import type { LocalSyntheticRuntimeDriver } from '@zhiju/integration-gateway';
import { canonicalize, newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import { describe, expect } from 'vitest';
import { createExitQueries } from './controlled-exit-queries.js';
import {
  contentHash,
  definedValue,
  gateEnabled,
  record,
  type ControlledExitHooks,
} from './initial-context-fixtures.js';
import type { ScenarioBoardProbe } from './initial-context-scenario-types.js';
import {
  registerIsolatedInitialContextGroups,
  type IsolatedInitialContextCase,
} from './initial-context-isolated-cases.js';

// Each primary chain owns a migrated empty TE database. Only independent
// chains overlap; the Release-required counterexample stays inside its chain.
describe.skipIf(!gateEnabled)('TD-07 controlled exit (real PostgreSQL)', () => {
  const cases: IsolatedInitialContextCase[] = [];
  for (const profile of ['normal', 'recovered', 'cancel', 'cancel-progress'] as const)
    cases.push({
      name: `EXIT-D-${profile === 'normal' ? '001/003/006' : profile === 'recovered' ? '002/003/006' : '005/006'} ${profile} unified owning chain`,
      timeout: 900_000,
      run: async (suite, runScenario) => {
        const cancellation = profile === 'cancel' || profile === 'cancel-progress';
        const evidence: Record<string, unknown> = { profile, faults: [], stages: [], delivery: [] };
        const faults = evidence.faults as unknown[];
        const stages = evidence.stages as unknown[];
        const delivery = evidence.delivery as unknown[];
        let driver: LocalSyntheticRuntimeDriver | undefined;
        const invocations: { primary: readonly string[]; releaseRequired?: readonly string[] } = {
          primary: [],
        };
        const runs = new Map<string, Common.ObjectRef>();
        for (const table of ['task', 'work_order', 'run', 'agent_result', 'information_request'])
          expect(
            (await suite.admin.query(`SELECT count(*)::int n FROM task_execution.${table}`)).rows,
          ).toEqual([{ n: 0 }]);
        const queries = await createExitQueries(suite);
        const reached = new Set<string>();
        const recoveredCommands = new Set<unknown>();
        const pendingResponses = new Map<
          unknown,
          {
            bytes: string;
            committed: unknown;
            receipts: unknown;
            before: unknown;
            invoked: readonly string[];
          }
        >();
        const required =
          profile === 'normal'
            ? [
                'execution.submit_agent_result',
                'execution.accept_agent_result',
                'execution.finalize_run_from_acceptance',
              ]
            : profile === 'recovered'
              ? ['execution.resolve_information_request']
              : [];
        async function readOnly(runRef: Common.ObjectRef, blocked: boolean, stage: string) {
          runs.set(runRef.objectId, runRef);
          const before = await queries.snapshot();
          const technicalBefore = await queries.technicalCounts();
          const invoked = [...definedValue(driver).invokedAttemptIds];
          const usage = await queries.assertUsage(runRef);
          const board = await queries.assertBoard(runRef, blocked);
          expect(await queries.snapshot()).toEqual(before);
          expect(definedValue(driver).invokedAttemptIds).toEqual(invoked);
          stages.push({
            stage,
            runRef,
            usage,
            board,
            technicalBefore,
            technicalAfter: await queries.technicalCounts(),
          });
          return { usage, board };
        }
        async function readProjection() {
          const before = await queries.snapshot();
          const invoked = [...definedValue(driver).invokedAttemptIds];
          const result = await queries.readBoard('PROJECTION_OK');
          expect(await queries.snapshot()).toEqual(before);
          expect(definedValue(driver).invokedAttemptIds).toEqual(invoked);
          return result;
        }
        let published: unknown;
        const boardProbe: ScenarioBoardProbe = async (stage, runRef) => {
          const blocked =
            profile === 'recovered' && !['RECOVERY_SUCCEEDED', 'COMPLETED'].includes(stage);
          const observed = await readOnly(runRef, blocked, stage);
          if (stage === 'FINAL_RESERVED') {
            published = await queries.exportPass();
            expect(published).toBeDefined();
            expect((await readProjection()).stalenessStatus).toBe('FRESH');
            if (profile === 'recovered') {
              expect(observed.board.blockerRefs).toHaveLength(1);
              expect(
                (await suite.admin.query('SELECT * FROM task_execution.information_request')).rows,
              ).toEqual([]);
            }
          }
          if (stage === 'RUN_FINALIZED') {
            expect(observed.board.status).not.toBe('COMPLETED');
            expect(observed.board.completionEvaluationRef).toBeUndefined();
          }
          if (stage === 'REQUEST_RESOLVED') expect(observed.board.blockerRefs).toHaveLength(1);
          if (stage === 'COMPLETED') {
            expect(observed.board.status).toBe('COMPLETED');
            expect(observed.board.activeWorkOrderRefs).toEqual([]);
            expect(observed.board.blockerRefs).toEqual([]);
            const stale = await readProjection();
            expect(stale.stalenessStatus).toBe('STALE');
            expect(record(stale.data).items).not.toContainEqual(observed.board);
            const next = await queries.exportPass();
            expect(next).not.toEqual(published);
            const fresh = await readProjection();
            expect(fresh.stalenessStatus).toBe('FRESH');
            expect(record(fresh.data).items).toContainEqual(observed.board);
            evidence.freshness = { published, stale, next, fresh };
          }
        };
        const hooks: ControlledExitHooks = {
          declareUsage: profile === 'normal',
          stage: async (stage, material) => {
            if (typeof material.taskId !== 'string') throw new Error('missing stage Task');
            const before = await queries.snapshot();
            const invoked = [...(driver?.invokedAttemptIds ?? [])];
            const board = await queries.assertTaskBoard(material.taskId, false);
            if (stage === 'TASK_DRAFT') expect(board.status).toBe('DRAFT');
            if (stage === 'TASK_READY' || stage === 'WORK_ORDER_READY')
              expect(board.status).toBe('READY');
            if (stage === 'WORK_ORDER_COMPLETED') expect(board.status).not.toBe('COMPLETED');
            expect(await queries.snapshot()).toEqual(before);
            expect(driver?.invokedAttemptIds ?? []).toEqual(invoked);
            stages.push({ stage, material, board });
          },
          runtime: (value) => {
            driver = value;
          },
          afterCommit: async (command, committed) => {
            if (
              typeof command.commandType !== 'string' ||
              typeof command.commandId !== 'string' ||
              typeof command.idempotencyKey !== 'string'
            )
              throw new Error('invalid command identity');
            const type = command.commandType;
            stages.push({
              stage: type,
              commandId: command.commandId,
              targetRef: command.targetRef,
              idempotencyKey: command.idempotencyKey,
              committed,
            });
            if (['execution.start_run', 'execution.finalize_run_from_acceptance'].includes(type)) {
              const runId = record(command.targetRef).objectId;
              if (typeof runId !== 'string') throw new Error('missing Run target');
              const ref = {
                kind: 'OBJECT',
                objectType: 'execution.run',
                objectId: runId,
                scope: suite.scope(),
              } as Common.ObjectRef;
              runs.set(runId, ref);
              const before = await queries.snapshot();
              const invoked = [...definedValue(driver).invokedAttemptIds];
              const usage = await queries.assertUsage(ref);
              expect(await queries.snapshot()).toEqual(before);
              expect(definedValue(driver).invokedAttemptIds).toEqual(invoked);
              stages.push({ stage: `${type}:USAGE`, usage });
            }
            if (!required.includes(type) || reached.has(type)) return;
            reached.add(type);
            expect(record(committed).status).toBe('COMMITTED');
            const bytes = canonicalize(command);
            const receipts = await suite.receiptRows(command.idempotencyKey);
            expect(receipts).toHaveLength(1);
            expect(receipts[0]).toMatchObject({ outcome: 'COMMITTED', command_type: type });
            const before = await queries.snapshot();
            const invoked = [...definedValue(driver).invokedAttemptIds];
            pendingResponses.set(command.commandId, {
              bytes,
              committed,
              receipts,
              before,
              invoked,
            });
            // Reject the actual entry invocation after its owning commit. The
            // outside test caller must observe failure before rebuilding it.
            throw new Error(`EXIT_RESPONSE_LOST:${command.commandId}`);
          },
          commandStatus: (commandId) =>
            recoveredCommands.has(commandId) ? 'DUPLICATE' : 'COMMITTED',
          invokeCommand: async (command, invokeEntry, replay) => {
            if (typeof command.commandId !== 'string' || typeof command.idempotencyKey !== 'string')
              throw new Error('invalid recovery command identity');
            let failure: unknown;
            try {
              return await invokeEntry();
            } catch (error) {
              failure = error;
            }
            const pending = pendingResponses.get(command.commandId);
            if (pending === undefined) throw failure;
            expect(failure).toMatchObject({
              message: `EXIT_RESPONSE_LOST:${command.commandId}`,
            });
            const { bytes, committed, receipts, before, invoked } = pending;
            expect(canonicalize(command)).toBe(bytes);
            // The caller has no successful reply, while the committed business
            // rows and original Receipt remain independently readable.
            expect(await queries.snapshot()).toEqual(before);
            expect(await suite.receiptRows(command.idempotencyKey)).toEqual(receipts);
            expect(definedValue(driver).invokedAttemptIds).toEqual(invoked);
            const duplicate = await replay();
            expect(record(duplicate)).toMatchObject({
              status: 'DUPLICATE',
              resultPayload: record(committed).resultPayload,
            });
            expect(canonicalize(command)).toBe(bytes);
            expect(await suite.receiptRows(command.idempotencyKey)).toEqual(receipts);
            expect(await queries.snapshot()).toEqual(before);
            expect(definedValue(driver).invokedAttemptIds).toEqual(invoked);
            faults.push({
              boundary: command.commandType,
              callerObserved: 'REJECTED',
              replayStatus: record(duplicate).status,
              reached: 'COMMITTED',
              commandId: command.commandId,
              targetRef: command.targetRef,
              idempotencyKey: command.idempotencyKey,
              payloadHash: contentHash(
                digestCanonicalPayload(command.payload as CanonicalJsonObject).hash.toString('hex'),
              ),
              receipts,
              replay: duplicate,
            });
            pendingResponses.delete(command.commandId);
            recoveredCommands.add(command.commandId);
            return duplicate;
          },
          deliveryTail: async (plan, taskId, _service, requiresRelease) => {
            const { entry, roles, session, projectRef, config } =
              await suite.deliveryTestEntries(taskId);
            const ids = await entry.scan(projectRef, session(roles.dispatcher));
            const eventId = definedValue(
              ids.find((id) => !delivery.some((d) => record(d).eventId === id)),
            );
            const claim = await entry.claim(projectRef, eventId, session(roles.dispatcher));
            if (claim.status !== 'CLAIMED') throw new Error('Expected actual Outbox claim');
            const material = await entry.readClaimed(claim, session(roles.dispatcher));
            const consumed = await entry.consume(material, session(roles.consumer));
            if (consumed.status !== 'PROCESSED') throw new Error('Expected real EP commit');
            const request = {
              deliveryPlanRef: plan.deliveryPlanRef,
              deliveryItemRef: plan.deliveryItemRef,
              factRefs: [consumed.factRef],
            };
            expect(await entry.readExact(request, session(roles.reader))).toMatchObject({
              derivedStatus: 'NOT_EVALUATED',
              completionAggregateVersion: 1,
            });
            const immutable = async () =>
              (
                await suite.admin.query<{ kind: string; bytes: unknown }>(
                  `SELECT 'fact' kind,to_jsonb(f) bytes FROM enterprise_project.delivery_item_completion_fact f WHERE event_id=$1 UNION ALL SELECT 'association',to_jsonb(a) FROM enterprise_project.delivery_completion_task_association a WHERE event_id=$1 UNION ALL SELECT 'inbox',to_jsonb(i) FROM enterprise_project.inbox_message i WHERE event_id=$1 ORDER BY kind`,
                  [eventId],
                )
              ).rows;
            const before = await immutable();
            const invoked = [...definedValue(driver).invokedAttemptIds];
            // Losing the response before TE confirm leaves the real EP Inbox,
            // Fact and Association committed. Its dispatcher owns bounded retry.
            await expect(
              Promise.resolve().then(() => {
                throw new Error('EXIT_EP_RESPONSE_LOST');
              }),
            ).rejects.toThrow('EXIT_EP_RESPONSE_LOST');
            expect(
              await entry.markFailure(
                claim,
                'DISPATCH_TRANSPORT_UNKNOWN',
                session(roles.dispatcher),
              ),
            ).toBe('UNKNOWN');
            await suite.waitForDeadline(2100, 'TD-07 dispatch response loss backoff');
            suite.clock = Date.now();
            const rebuilt = createTaskCompletedDeliveryEntry({
              ...config,
              workerInstanceId: 'exit-rebuilt',
            });
            const reclaimed = await rebuilt.claim(projectRef, eventId, session(roles.dispatcher));
            if (reclaimed.status !== 'CLAIMED')
              throw new Error('Expected bounded dispatcher retry');
            const replay = await rebuilt.readClaimed(reclaimed, session(roles.dispatcher));
            expect(replay).toEqual(material);
            const duplicate = await rebuilt.consume(replay, session(roles.consumer));
            expect(duplicate).toMatchObject({ status: 'DUPLICATE', factRef: consumed.factRef });
            expect(await immutable()).toEqual(before);
            expect(definedValue(driver).invokedAttemptIds).toEqual(invoked);
            await rebuilt.confirm(
              reclaimed,
              replay,
              duplicate as unknown as CanonicalJsonObject,
              session(roles.dispatcher),
            );
            const evaluated = await rebuilt.evaluate(
              { payload: request, expectedAggregateVersion: 1, idempotencyKey: newUuidV7() },
              session(roles.evaluator),
            );
            expect(evaluated).toMatchObject({
              status: 'COMMITTED',
              resultPayload: {
                outcome: requiresRelease ? 'UNSATISFIED' : 'SATISFIED',
                aggregateVersion: 2,
              },
            });
            const readback = await rebuilt.readExact(request, session(roles.reader));
            expect(readback).toMatchObject({
              derivedStatus: requiresRelease ? 'UNSATISFIED' : 'SATISFIED',
              completionAggregateVersion: 2,
              selectedEvaluationIsCurrent: true,
            });
            expect(readback.facts[0]).toMatchObject({
              taskRef: material.sidecar.taskRef,
              bindingHash: material.bindingHash,
              sourceWatermark: material.sourceWatermark,
            });
            expect(
              (
                await suite.admin.query(
                  `SELECT (SELECT count(*)::int FROM enterprise_project.delivery_item_completion_fact WHERE event_id=$1) facts,(SELECT count(*)::int FROM enterprise_project.delivery_completion_task_association WHERE event_id=$1) associations,(SELECT count(*)::int FROM enterprise_project.delivery_item_completion_evaluation WHERE delivery_item_id=$2) evaluations,(SELECT count(*)::int FROM task_execution.outbox_event WHERE event_id=$1 AND delivery_state='PUBLISHED') delivered`,
                  [eventId, plan.deliveryItemRef.objectId],
                )
              ).rows,
            ).toEqual([{ facts: 1, associations: 1, evaluations: 1, delivered: 1 }]);
            delivery.push({
              eventId,
              requiresRelease,
              material,
              consumed,
              duplicate,
              evaluated,
              readback,
            });
            faults.push({
              boundary: 'EP_CONSUME_BEFORE_TE_CONFIRM',
              reached: 'COMMITTED',
              eventId,
              material,
              consumed,
              duplicate,
            });
          },
        };
        await runScenario(
          cancellation
            ? 'RUN_CANCEL'
            : profile === 'normal'
              ? 'FORMAL_DELIVERY_NORMAL'
              : 'FORMAL_DELIVERY_RECOVERED',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'NORMAL',
          false,
          undefined,
          cancellation
            ? {
                row: profile === 'cancel' ? 'CANCEL-D-003' : 'CANCEL-D-008',
                bounded: true,
                phase: 'SUPPORTED',
              }
            : undefined,
          async (stage, runRef) => {
            const { usage } = await readOnly(
              runRef,
              profile === 'recovered' && ['SUBMITTED', 'ACCEPTED'].includes(stage),
              stage,
            );
            if (stage === 'ISOLATED') {
              expect(usage.agentDeclaredUsage).toMatchObject({
                presence: 'UNKNOWN',
                reasonCode: 'LATE_RESULT',
              });
              expect(record(usage.provenance).runStatus).toBe('ABANDONED');
            }
          },
          boardProbe,
          hooks,
        );
        for (const type of required)
          expect(reached.has(type), `unreached committed fault ${type}`).toBe(true);
        expect(pendingResponses.size).toBe(0);
        expect(recoveredCommands.size).toBe(required.length);
        invocations.primary = [...definedValue(driver).invokedAttemptIds];
        expect(invocations.primary).toHaveLength(profile === 'recovered' ? 2 : 1);
        for (const ref of runs.values()) await readOnly(ref, false, 'FINAL_READBACK');
        evidence.invocations = invocations;
        if (!cancellation) {
          expect(delivery).toHaveLength(1);
          // Fresh legal Task+Release Item: its own actual calls are not charged
          // to the primary WorkOrder and no Release fact is fabricated.
          await runScenario(
            profile === 'normal' ? 'FORMAL_DELIVERY_NORMAL' : 'FORMAL_DELIVERY_RECOVERED',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            'NORMAL',
            true,
            undefined,
            undefined,
            undefined,
            undefined,
            {
              runtime: definedValue(hooks.runtime),
              deliveryTail: definedValue(hooks.deliveryTail),
            },
          );
          invocations.releaseRequired = [...definedValue(driver).invokedAttemptIds];
          expect(invocations.releaseRequired).toHaveLength(profile === 'recovered' ? 2 : 1);
          expect(delivery).toHaveLength(2);
        } else {
          expect(
            (
              await suite.admin.query(
                `SELECT (SELECT count(*)::int FROM task_execution.run) runs,(SELECT count(*)::int FROM task_execution.agent_result_acceptance) acceptances,(SELECT count(*)::int FROM task_execution.information_request) requests,(SELECT count(*)::int FROM task_execution.outbox_event WHERE event_type IN ('execution.TaskCompleted','execution.WorkOrderCompleted')) completions`,
              )
            ).rows,
          ).toEqual([{ runs: 1, acceptances: 0, requests: 0, completions: 0 }]);
          expect(
            (
              await suite.admin.query(
                "SELECT state,blocked_reason_code FROM task_execution.process_instance WHERE process_type='controlled-final@1'",
              )
            ).rows,
          ).toEqual(
            profile === 'cancel-progress'
              ? [{ state: 'SUSPENDED', blocked_reason_code: 'RUN_CANCELLING' }]
              : [],
          );
          evidence.finalProgress = (
            await suite.admin.query(
              "SELECT process_id,state,blocked_reason_code,controlled_final_attempt_ref,controlled_final_source_ref FROM task_execution.process_instance WHERE process_type='controlled-final@1'",
            )
          ).rows;
          evidence.finalTiming = (
            await suite.admin.query(
              "SELECT r.run_id,r.status,r.ended_at,o.attempt_id,o.observation_id,o.observed_at,o.result_payload->>'submittedAt' submitted_at,encode(o.result_payload_hash,'hex') result_hash FROM task_execution.run r JOIN integration_gateway.runtime_final_observation o ON o.attempt_id::text=r.start_attempt_ref->>'objectId'",
            )
          ).rows;
          evidence.lateAudits = (
            await suite.admin.query(
              "SELECT audit_id,runtime_ref,encode(result_payload_hash,'hex') result_hash FROM task_execution.audit_record WHERE error_code='LATE_RESULT'",
            )
          ).rows;
        }
        evidence.sources = (
          await suite.admin.query(
            `SELECT run_id,attempt_number,status,context_snapshot_ref,work_order_contract_ref,capability_grant_ref,start_attempt_ref,runtime_adapter_identity_ref,result_ref,acceptance_ref,fencing_token FROM task_execution.run ORDER BY work_order_id,attempt_number`,
          )
        ).rows;
        evidence.budgets = (
          await suite.admin.query(
            `SELECT b.run_id,b.total_seconds,b.reserved_seconds,c.consumed_seconds FROM task_execution.run_budget_reservation b LEFT JOIN task_execution.run_budget_consumption c USING(run_id) ORDER BY b.run_id`,
          )
        ).rows;
        // Emit identities and hashes, not entire immutable contract documents.
        console.log(
          `EXIT_EVIDENCE ${JSON.stringify({
            profile,
            invocations,
            sources: evidence.sources,
            budgets: evidence.budgets,
            lateAudits: evidence.lateAudits,
            finalProgress: evidence.finalProgress,
            finalTiming: evidence.finalTiming,
            stages: stages.map((stage) => {
              const value = record(stage);
              return {
                stage: value.stage,
                runRef: value.runRef,
                board: value.board,
                commandId: value.commandId,
                targetRef: value.targetRef,
                idempotencyKey: value.idempotencyKey,
                result: record(value.committed).resultPayload,
                technicalBefore: value.technicalBefore,
                technicalAfter: value.technicalAfter,
              };
            }),
            faults: faults.map((fault) => {
              const value = record(fault);
              return {
                boundary: value.boundary,
                reached: value.reached,
                callerObserved: value.callerObserved,
                replayStatus: value.replayStatus,
                commandId: value.commandId,
                targetRef: value.targetRef,
                idempotencyKey: value.idempotencyKey,
                payloadHash: value.payloadHash,
                eventId: value.eventId,
                receipts: Array.isArray(value.receipts)
                  ? value.receipts.map((receipt: unknown) => {
                      const row = record(receipt);
                      return {
                        commandId: row.command_id,
                        outcome: row.outcome,
                        payloadHash: row.request_payload_hash,
                        resultHash: row.result_payload_hash,
                      };
                    })
                  : undefined,
              };
            }),
            delivery: delivery.map((item) => {
              const value = record(item);
              return {
                eventId: value.eventId,
                requiresRelease: value.requiresRelease,
                material: value.material,
                consumed: value.consumed,
                replay: value.duplicate,
                readback: value.readback,
              };
            }),
            freshness: evidence.freshness,
          })}`,
        );
      },
    });
  registerIsolatedInitialContextGroups(
    [
      {
        label: 'controlled exit normal and cancel',
        cases: [definedValue(cases[0]), definedValue(cases[2])],
      },
      {
        label: 'controlled exit recovered and cancel-progress',
        cases: [definedValue(cases[1]), definedValue(cases[3])],
      },
    ],
    { databasePerCase: true, deliveryOnly: true },
  );
});
