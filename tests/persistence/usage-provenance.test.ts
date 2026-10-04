// IM-06 (#246): Human Run Usage and Provenance readback over real PostgreSQL.
//
// These cases drive the owning chain with the real synthetic Driver and then
// read `execution.get_usage_and_provenance@1.0` through the trusted composition
// entry, so the Usage/Provenance evidence comes from committed owning facts and
// an actual invocation, never from direct business-table writes.

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createUsageProvenanceEntry, type UsageProvenanceSession } from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import {
  createActorSnapshot,
  createUsageProvenanceAuthorizationPort,
  USAGE_PROVENANCE_BINDINGS,
  withIdentityTransaction,
  type UsageProvenanceCapabilityCodes,
} from '@zhiju/identity-policy';
import {
  createIntegrationRendererDatabase,
  InMemoryRenderObjectStorage,
  type SyntheticRuntimeDriver,
} from '@zhiju/integration-gateway';
import { digestCanonicalPayload } from '@zhiju/task-execution';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { KyselyPlugin, QueryId } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { postgresImageReference } from '../../tools/persistence/baseline.mjs';
import { runFlyway } from '../../tools/persistence/flyway.mjs';
import {
  AUTH_HASH,
  definedValue,
  gateEnabled,
  OPERATOR,
  PRINCIPAL_OBJECT,
  type Principal,
} from './initial-context-fixtures.js';
import { createRunScenario } from './initial-context-scenario.js';
import { createInitialContextSuite } from './initial-context-suite.js';

const SERVICE_PRINCIPAL = newUuidV7();
const SERVICE_ACTOR = newUuidV7();
const SERVICE_AUTH = Buffer.alloc(32, 0x78);

const container: StartedPostgreSqlContainer | undefined = gateEnabled
  ? await new PostgreSqlContainer(postgresImageReference())
      .withDatabase('zhiju_core')
      .withUsername('postgres')
      .withPassword('zhiju-gate-test')
      .withStartupTimeout(120_000)
      .start()
  : undefined;

beforeAll(async () => {
  await runFlyway(definedValue(container).getId(), {
    command: 'migrate',
    database: 'zhiju_core',
    username: 'postgres',
    password: 'zhiju-gate-test',
  });
}, 600_000);

afterAll(async () => {
  await container?.stop();
}, 120_000);

function contentHash(digest: string): Common.ContentHash {
  return { algorithm: 'SHA-256', canonicalizationVersion: '1', digest };
}

interface UsageHarness {
  readonly runUsage: (
    runRef: Common.ObjectRef,
    options?: {
      readonly decisionTarget?: Common.ObjectRef;
      readonly revokeAfterIssue?: boolean;
      readonly expireAfterIssue?: boolean;
      readonly expireAtBarrier?: boolean;
      readonly barrier?: () => Promise<void>;
    },
  ) => Promise<CanonicalJsonObject>;
  readonly counts: () => Promise<Record<string, number>>;
  readonly protectedReads: () => readonly string[];
  readonly igReads: () => readonly string[];
  readonly writes: () => readonly string[];
  readonly runRow: (
    runId: string,
  ) => Promise<{ status: string; aggregate_version: string } | undefined>;
  readonly revokeGrant: (key: keyof UsageProvenanceCapabilityCodes) => Promise<void>;
  readonly restoreGrant: (key: keyof UsageProvenanceCapabilityCodes) => Promise<void>;
  readonly armGate: (action?: () => Promise<void>) => Promise<void>;
  readonly releaseGate: () => void;
  readonly humanDecisionForAgent: (runRef: Common.ObjectRef) => Promise<string>;
}

describe.skipIf(!gateEnabled)(
  'Human Run Usage and Provenance readback (isolated PostgreSQL)',
  () => {
    const databaseUrl = container?.getConnectionUri();
    const suite = createInitialContextSuite(databaseUrl === undefined ? {} : { databaseUrl });
    const runScenario = createRunScenario(suite);
    let harness: UsageHarness | undefined;
    let usageIgPool: pg.Pool | undefined;
    let succeededRunId: string | undefined;

    afterAll(async () => {
      await usageIgPool?.end();
    }, 60_000);

    async function usageHarness(): Promise<UsageHarness> {
      if (harness !== undefined) return harness;
      const { enterpriseId, projectId } = suite.fixture;
      const scope = { enterpriseId, projectId };
      const operator = suite.operator();
      await withIdentityTransaction(suite.identityDb, suite.identityContext([]), (trx) =>
        suite.identityRepo.insertPrincipal(trx, {
          id: SERVICE_PRINCIPAL,
          principalKind: 'SERVICE',
          displayName: 'IM-06 #246 usage source reader',
          createdByPrincipalId: OPERATOR,
          createdByActorSnapshotId: operator.actorSnapshotId,
        }),
      );
      const serviceActorRef = await createActorSnapshot(suite.identityDeps([projectId], operator), {
        actorSnapshotId: SERVICE_ACTOR,
        principalId: SERVICE_PRINCIPAL,
        declaredPrincipalKind: 'SERVICE',
        authenticationContextHash: SERVICE_AUTH,
        scopeKind: 'PROJECT',
        enterpriseId,
        projectId,
      });
      const servicePrincipal: Principal = {
        principalId: SERVICE_PRINCIPAL,
        principalKind: 'SERVICE',
        actorSnapshotId: SERVICE_ACTOR,
        actorRef: serviceActorRef,
        authHash: SERVICE_AUTH,
      };

      const capabilityCodes = Object.fromEntries(
        USAGE_PROVENANCE_BINDINGS.map((binding, index) => [
          binding.capabilityConfigKey,
          `wi246.usage.c${index}.${SERVICE_PRINCIPAL.replaceAll('-', '')}`,
        ]),
      ) as UsageProvenanceCapabilityCodes;
      const grantIds = new Map<string, string>();
      await suite.prepareIndependentGrants(USAGE_PROVENANCE_BINDINGS, async (binding) => {
        const targetObjectType = binding.targetObjectTypes[0];
        if (targetObjectType === undefined) throw new Error('missing usage target');
        grantIds.set(
          binding.capabilityConfigKey,
          await suite.grant({
            principal: binding.expectedPrincipalKind === 'HUMAN' ? operator : servicePrincipal,
            capabilityCode: capabilityCodes[binding.capabilityConfigKey],
            action: binding.requiredGrantAction,
            selectorType: binding.selectorType,
            targetObjectType,
          }),
        );
      });

      const reads: string[] = [];
      let gateAction: (() => Promise<void>) | undefined;
      let gatePromise: Promise<void> | undefined;
      let gateRelease: (() => void) | undefined;
      let gateReach: (() => void) | undefined;
      let gateQueryId: QueryId | undefined;
      const queryProbe: KyselyPlugin = {
        transformQuery(args) {
          const serialized = JSON.stringify(args.node);
          reads.push(serialized);
          if (
            gatePromise !== undefined &&
            gateQueryId === undefined &&
            serialized.includes('"name":"task_execution"') &&
            serialized.includes('"name":"run"')
          )
            gateQueryId = args.queryId;
          return args.node;
        },
        async transformResult(args) {
          if (gateQueryId !== undefined && args.queryId === gateQueryId) {
            gateQueryId = undefined;
            const action = gateAction;
            const pending = gatePromise;
            const reach = gateReach;
            gateAction = undefined;
            gatePromise = undefined;
            gateReach = undefined;
            reach?.();
            if (action !== undefined) await action();
            else if (pending !== undefined) await pending;
          }
          return args.result;
        },
      };
      const driver: SyntheticRuntimeDriver = {
        invoke: () => Promise.reject(new Error('the usage read must never invoke the Driver')),
        readBack: () => Promise.resolve(undefined),
      };
      const igPool = new pg.Pool({ connectionString: suite.activeDatabaseUrl, max: 4 });
      igPool.on('error', () => undefined);
      usageIgPool = igPool;
      const entry = createUsageProvenanceEntry({
        taskExecutionDb: suite.teDb.withPlugin(queryProbe),
        integrationGatewayDb: createIntegrationRendererDatabase(igPool).withPlugin(queryProbe),
        runtimeDriver: driver,
        receiptStorage: new InMemoryRenderObjectStorage(),
        identity: { db: suite.identityDb, repo: suite.identityRepo, crypto: suite.crypto },
        capabilityCodes,
        now: () => new Date(suite.clock),
      });
      const auth = createUsageProvenanceAuthorizationPort({
        capabilityCodes,
        now: () => new Date(suite.clock),
      });

      /**
       * Pauses the next usage read after its first TaskExecution Run read, so a
       * test can commit another owning fact on a second connection while the
       * read keeps its REPEATABLE READ snapshot. `action` runs at the barrier
       * instead of waiting for an explicit release.
       */
      function armGate(action?: () => Promise<void>): Promise<void> {
        gateAction = action;
        const reached = new Promise<void>((resolve) => {
          gateReach = resolve;
        });
        gatePromise = new Promise<void>((resolve) => {
          gateRelease = resolve;
        });
        gateQueryId = undefined;
        return reached;
      }

      function releaseGate(): void {
        gateRelease?.();
      }

      async function runUsage(
        runRef: Common.ObjectRef,
        options: {
          readonly decisionTarget?: Common.ObjectRef;
          readonly revokeAfterIssue?: boolean;
          readonly expireAfterIssue?: boolean;
          readonly expireAtBarrier?: boolean;
          readonly barrier?: () => Promise<void>;
        } = {},
      ): Promise<CanonicalJsonObject> {
        reads.length = 0;
        const payload = { runRef } as unknown as CanonicalJsonObject;
        const payloadHash = digestCanonicalPayload(payload).hash;
        const human = await auth.authorize(
          suite.identityDeps([projectId], operator),
          'runUsageProvenanceReadHumanV1',
          {
            actorSnapshotRef: operator.actorRef,
            commandType: 'execution.get_usage_and_provenance',
            commandVersion: '1.0',
            commandPayloadHash: payloadHash,
            authenticationContextHash: AUTH_HASH,
            targetRef: options.decisionTarget ?? runRef,
          },
        );
        if (human.outcome !== 'ALLOW') throw new Error('Human usage Decision denied');
        if (options.revokeAfterIssue === true) await revokeGrant('runUsageProvenanceReadHumanV1');
        const source = await auth.authorize(
          suite.identityDeps([projectId], servicePrincipal),
          'runUsageProvenanceSourceReadV1',
          {
            actorSnapshotRef: serviceActorRef,
            commandType: 'execution.run.usage_provenance.source.read.v1',
            commandVersion: '1.0',
            commandPayloadHash: payloadHash,
            authenticationContextHash: SERVICE_AUTH,
            targetRef: runRef,
          },
        );
        if (source.outcome !== 'ALLOW') throw new Error('SERVICE source Decision denied');
        const session: UsageProvenanceSession = {
          authenticationContextHash: AUTH_HASH,
          resolutionActorSnapshotRef: operator.actorRef,
          serviceSession: {
            authenticationContextHash: SERVICE_AUTH,
            resolutionActorSnapshotRef: serviceActorRef,
            sourceDecisionRef: source.authorizationDecisionRef,
          },
        };
        const envelope = {
          queryId: newUuidV7(),
          queryType: 'execution.get_usage_and_provenance',
          queryVersion: '1.0',
          scopeRef: scope,
          requester: { kind: 'OBJECT', objectType: PRINCIPAL_OBJECT, objectId: OPERATOR, scope },
          authenticationContextRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'zhiju.identity.authentication_context',
            objectId: operator.actorSnapshotId,
            scope,
            contentHash: contentHash(AUTH_HASH.toString('hex')),
          },
          authorizationDecisionRef: human.authorizationDecisionRef,
          consistencyRequirement: 'AUTHORITATIVE',
          correlationId: newUuidV7(),
          requestedAt: new Date(suite.clock).toISOString(),
          payload,
        };
        if (options.expireAtBarrier === true) {
          const saved = suite.clock;
          void armGate(() => {
            suite.clock = saved + 86_400_000;
            return Promise.resolve();
          });
          try {
            return await entry.getUsageAndProvenance(envelope, session);
          } finally {
            suite.clock = saved;
          }
        }
        if (options.expireAfterIssue !== true) {
          if (options.barrier !== undefined) void armGate(options.barrier);
          return entry.getUsageAndProvenance(envelope, session);
        }
        const issuedClock = suite.clock;
        suite.clock = issuedClock + 86_400_000;
        try {
          return await entry.getUsageAndProvenance(envelope, session);
        } finally {
          suite.clock = issuedClock;
        }
      }

      async function counts(): Promise<Record<string, number>> {
        const rows = await suite.admin.query<{ table_name: string; total: string }>(
          `SELECT table_name, total FROM (
             SELECT 'receipt' AS table_name, count(*)::text AS total FROM task_execution.command_receipt
             UNION ALL SELECT 'outbox', count(*)::text FROM task_execution.outbox_event
             UNION ALL SELECT 'acceptance', count(*)::text FROM task_execution.agent_result_acceptance
             UNION ALL SELECT 'edge', count(*)::text FROM task_execution.reference_edge
             UNION ALL SELECT 'audit', count(*)::text FROM task_execution.audit_record
             UNION ALL SELECT 'result', count(*)::text FROM task_execution.agent_result
           ) counts`,
        );
        return Object.fromEntries(rows.rows.map((row) => [row.table_name, Number(row.total)]));
      }

      async function revokeGrant(key: keyof UsageProvenanceCapabilityCodes): Promise<void> {
        const grantId = grantIds.get(key);
        const binding = USAGE_PROVENANCE_BINDINGS.find(
          (candidate) => candidate.capabilityConfigKey === key,
        );
        if (grantId === undefined || binding === undefined)
          throw new Error(`missing usage Grant ${key}`);
        const principal = binding.expectedPrincipalKind === 'HUMAN' ? operator : servicePrincipal;
        expect(
          await suite.revokeCapabilityTracked(suite.identityDeps([projectId], principal), {
            targetId: grantId,
            expectedAggregateVersion: '1',
            scope: { scopeKind: 'PROJECT', enterpriseId, projectId },
            reasonCode: `WI246_REVOKE_${key}`,
            effectiveAt: new Date(suite.clock),
            idempotencyKey: newUuidV7(),
          }),
        ).toMatchObject({ status: 'COMMITTED' });
      }

      async function restoreGrant(key: keyof UsageProvenanceCapabilityCodes): Promise<void> {
        const binding = USAGE_PROVENANCE_BINDINGS.find(
          (candidate) => candidate.capabilityConfigKey === key,
        );
        const targetObjectType = binding?.targetObjectTypes[0];
        if (binding === undefined || targetObjectType === undefined)
          throw new Error(`missing usage binding ${key}`);
        const principal = binding.expectedPrincipalKind === 'HUMAN' ? operator : servicePrincipal;
        grantIds.set(
          key,
          await suite.grant({
            principal,
            capabilityCode: capabilityCodes[key],
            action: binding.requiredGrantAction,
            selectorType: binding.selectorType,
            targetObjectType,
          }),
        );
      }

      async function humanDecisionForAgent(runRef: Common.ObjectRef): Promise<string> {
        const payload = { runRef } as unknown as CanonicalJsonObject;
        const view = await auth.authorize(
          suite.identityDeps([projectId], servicePrincipal),
          'runUsageProvenanceReadHumanV1',
          {
            actorSnapshotRef: serviceActorRef,
            commandType: 'execution.get_usage_and_provenance',
            commandVersion: '1.0',
            commandPayloadHash: digestCanonicalPayload(payload).hash,
            authenticationContextHash: SERVICE_AUTH,
            targetRef: runRef,
          },
        );
        return view.outcome;
      }

      harness = {
        runUsage,
        counts,
        protectedReads: () =>
          reads.filter((query) => /"name":"(?:task_execution|integration_gateway)"/u.test(query)),
        igReads: () => reads.filter((query) => query.includes('"name":"integration_gateway"')),
        writes: () =>
          reads.filter((query) =>
            /"kind":"(?:InsertQueryNode|UpdateQueryNode|DeleteQueryNode)"/u.test(query),
          ),
        runRow: async (runId) =>
          (
            await suite.admin.query<{ status: string; aggregate_version: string }>(
              'SELECT status, aggregate_version FROM task_execution.run WHERE run_id=$1',
              [runId],
            )
          ).rows[0],
        revokeGrant,
        restoreGrant,
        armGate,
        releaseGate,
        humanDecisionForAgent,
      };
      return harness;
    }

    async function latestRunId(statuses: readonly string[]): Promise<string> {
      const row = (
        await suite.admin.query<{ run_id: string }>(
          `SELECT run_id FROM task_execution.run
           WHERE status = ANY($1::text[]) ORDER BY created_at DESC LIMIT 1`,
          [statuses],
        )
      ).rows[0];
      if (row === undefined) throw new Error(`no Run fixture in ${statuses.join('/')}`);
      return row.run_id;
    }

    function runRefOf(runId: string): Common.ObjectRef {
      return {
        kind: 'OBJECT',
        objectType: 'execution.run',
        objectId: runId,
        scope: { enterpriseId: suite.fixture.enterpriseId, projectId: suite.fixture.projectId },
      };
    }

    suite.itIntegration(
      'USAGE-D-001/002/003 stage-accurate Usage and Provenance for the normal first Run',
      async () => {
        const h = await usageHarness();
        const seen: Record<string, CanonicalJsonObject> = {};
        let paused: Promise<CanonicalJsonObject> | undefined;
        await runScenario(
          'SUCCEEDED',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'NORMAL',
          false,
          undefined,
          undefined,
          async (stage, runRef) => {
            if (stage === 'SUBMITTED') {
              // Deterministic two-connection Acceptance schedule: wait for the
              // read to reach its first Run SELECT (snapshot fixed) before the
              // owning Acceptance commits, then pause it while the scenario
              // keeps running.
              const reached = h.armGate();
              paused = h.runUsage(runRef);
              paused.catch(() => undefined);
              await reached;
              return;
            }
            if (stage === 'ACCEPTED') {
              h.releaseGate();
              const snapshot = await (paused ?? Promise.reject(new Error('no paused read')));
              seen.SNAPSHOT = snapshot;
              seen.SUBMITTED = snapshot;
              return;
            }
            const result = await h.runUsage(runRef);
            seen[stage] = result;
            expect(result.runRef).toEqual(runRef);
            expect(h.writes()).toEqual([]);
            if (stage === 'CREATED') {
              expect(result.agentDeclaredUsage).toMatchObject({
                presence: 'UNKNOWN',
                reasonCode: 'SOURCE_NOT_OBSERVED',
              });
              expect(h.igReads()).toEqual([]);
            }
          },
        );

        // The paused read kept its old snapshot across the newly committed
        // Acceptance child; the later FINALIZED read observes it.
        expect(seen.SNAPSHOT?.agentDeclaredUsage).toMatchObject({
          presence: 'UNKNOWN',
          reasonCode: 'RESULT_NOT_ACCEPTED',
        });
        expect(seen.SNAPSHOT?.provenance).toMatchObject({
          resultEvidence: { presence: 'UNKNOWN', reasonCode: 'RESULT_NOT_ACCEPTED' },
        });

        const created = seen.CREATED;
        const started = seen.STARTED;
        const submitted = seen.SUBMITTED;
        const finalized = seen.FINALIZED;
        if (
          created === undefined ||
          started === undefined ||
          submitted === undefined ||
          finalized === undefined
        )
          throw new Error('missing usage stage observation');
        expect((created.provenance as CanonicalJsonObject).runStatus).toBe('CREATED');
        expect((started.provenance as CanonicalJsonObject).runStatus).toBe('RUNNING');
        const startedAttempt = (started.provenance as CanonicalJsonObject)
          .attemptEvidence as CanonicalJsonObject;
        expect(startedAttempt).toMatchObject({
          presence: 'PRESENT',
          evidenceRefs: expect.any(Array),
        });
        expect(startedAttempt.value).not.toHaveProperty('observationRef');
        expect(started.agentDeclaredUsage).toMatchObject({
          presence: 'UNKNOWN',
          reasonCode: 'SOURCE_NOT_OBSERVED',
        });
        expect(submitted.agentDeclaredUsage).toMatchObject({
          presence: 'UNKNOWN',
          reasonCode: 'RESULT_NOT_ACCEPTED',
        });
        expect(finalized.agentDeclaredUsage).toEqual({
          presence: 'PRESENT',
          value: { measurementSource: 'AGENT_DECLARED', inputTokens: 17 },
          evidenceRefs: expect.any(Array),
        });
        expect(finalized.authoritativeSource).toBe('AGENT_DECLARED');
        expect(finalized.reconciliationStatus).toBe('execution.usage.agent_declared_only');
        expect(finalized.runtimeUsageRef).toBeUndefined();
        expect(finalized.provenance).toMatchObject({
          profile: 'execution.provenance.human_operated.v1',
          runStatus: 'SUCCEEDED',
        });
        const resultEvidence = (finalized.provenance as CanonicalJsonObject)
          .resultEvidence as CanonicalJsonObject;
        expect(resultEvidence).toMatchObject({
          presence: 'PRESENT',
          value: {
            agentResultRef: expect.any(Object),
            acceptanceRecordRef: expect.any(Object),
            resultPayloadHash: expect.any(Object),
          },
        });

        // A later query observes the same committed facts and changes nothing.
        const finalRunRef = finalized.runRef as CanonicalJsonObject;
        const runId = finalRunRef.objectId;
        if (typeof runId !== 'string') throw new Error('missing finalized Run id');
        succeededRunId = runId;
        const before = await h.counts();
        const beforeRow = await h.runRow(runId);
        const reread = await h.runUsage(runRefOf(runId));
        // A new read observes its own PostgreSQL snapshot instant but the same
        // committed facts.
        const stableProfile = (value: CanonicalJsonObject) => {
          const provenance = { ...(value.provenance as CanonicalJsonObject) };
          delete provenance.snapshotAt;
          return { ...value, provenance };
        };
        expect(stableProfile(reread)).toEqual(stableProfile(finalized));
        expect(await h.counts()).toEqual(before);
        expect(await h.runRow(runId)).toEqual(beforeRow);
        expect(h.writes()).toEqual([]);
        // The later conflicting resubmission was rejected and left the accepted
        // declaration intact.
        const acceptedEvidence = (finalized.provenance as CanonicalJsonObject)
          .resultEvidence as CanonicalJsonObject;
        const acceptedValue = acceptedEvidence.value as CanonicalJsonObject;
        const acceptedResultId = (acceptedValue.agentResultRef as CanonicalJsonObject).objectId;
        const rejected = (
          await suite.admin.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM task_execution.audit_record
             WHERE target_id=$1 AND command_type='execution.submit_agent_result'
               AND outcome='DENIED' AND error_code='EXECUTION_FINAL_CONFLICT'`,
            [acceptedResultId],
          )
        ).rows[0];
        expect(Number(rejected?.count ?? 0)).toBeGreaterThan(0);
        expect(reread.agentDeclaredUsage).toMatchObject({ presence: 'PRESENT' });
      },
      900_000,
    );

    suite.itIntegration(
      'USAGE-D-004 the cancelled Run keeps its original invocation and reads UNKNOWN / LATE_RESULT',
      async () => {
        const h = await usageHarness();
        await runScenario(
          'RUN_CANCEL',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'NORMAL',
          false,
          undefined,
          { row: 'IG-CANCEL-D-001', bounded: true, phase: 'CANCELLING' },
        );
        const runId = await latestRunId(['CANCELLING', 'ABANDONED']);
        const result = await h.runUsage(runRefOf(runId));
        expect(result.agentDeclaredUsage).toMatchObject({
          presence: 'UNKNOWN',
          reasonCode: 'LATE_RESULT',
        });
        expect(result.provenance).toMatchObject({
          resultEvidence: { presence: 'UNKNOWN', reasonCode: 'LATE_RESULT' },
        });
        const attemptEvidence = (result.provenance as CanonicalJsonObject)
          .attemptEvidence as CanonicalJsonObject;
        expect(attemptEvidence).toMatchObject({ presence: 'PRESENT' });
        expect(result.authoritativeSource).toBe('UNAVAILABLE');
        expect(result.runtimeUsageRef).toBeUndefined();
      },
      900_000,
    );

    suite.itIntegration(
      'USAGE-D-004 the abandoned Run isolates its late final and reads UNKNOWN / LATE_RESULT',
      async () => {
        const h = await usageHarness();
        await runScenario(
          'RUN_CANCEL',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'NORMAL',
          false,
          undefined,
          { row: 'IG-CANCEL-D-001', bounded: true, phase: 'ABANDONED' },
        );
        const runId = await latestRunId(['ABANDONED']);
        const result = await h.runUsage(runRefOf(runId));
        expect(result.agentDeclaredUsage).toMatchObject({
          presence: 'UNKNOWN',
          reasonCode: 'LATE_RESULT',
        });
        expect(result.provenance).toMatchObject({
          resultEvidence: { presence: 'UNKNOWN', reasonCode: 'LATE_RESULT' },
        });
        expect(result.authoritativeSource).toBe('UNAVAILABLE');
        expect(result.runtimeUsageRef).toBeUndefined();
      },
      900_000,
    );

    suite.itIntegration(
      'USAGE-D-004 accepted history survives execution eligibility expiry',
      async () => {
        const h = await usageHarness();
        const runId = succeededRunId ?? (await latestRunId(['SUCCEEDED']));
        const runRef = runRefOf(runId);
        const before = await h.runUsage(runRef);
        expect(before.agentDeclaredUsage).toMatchObject({ presence: 'PRESENT' });
        const saved = suite.clock;
        // Advance the trusted clock far past the Run lease/deadline: the
        // historical read must not require current execution eligibility, and
        // must not rewrite the accepted declaration.
        suite.clock = saved + 365 * 24 * 60 * 60 * 1000;
        try {
          const after = await h.runUsage(runRef);
          expect(after.agentDeclaredUsage).toMatchObject({ presence: 'PRESENT' });
          const stable = (value: CanonicalJsonObject) => {
            const provenance = { ...(value.provenance as CanonicalJsonObject) };
            delete provenance.snapshotAt;
            return { ...value, provenance };
          };
          expect(stable(after)).toEqual(stable(before));
        } finally {
          suite.clock = saved;
        }
      },
      900_000,
    );

    suite.itIntegration(
      'USAGE-D-003 the recovery chain reads Run-1 and its Context-2 Run-2 independently',
      async () => {
        const h = await usageHarness();
        await runScenario(
          'BOUNDED_RECOVERY',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'NORMAL',
          false,
          undefined,
          undefined,
        );
        const rows = (
          await suite.admin.query<{
            run_id: string;
            attempt_number: number;
            status: string;
          }>(
            `SELECT run_id, attempt_number, status FROM task_execution.run
             WHERE work_order_id = (
               SELECT work_order_id FROM task_execution.run ORDER BY created_at DESC LIMIT 1
             )
             ORDER BY attempt_number`,
          )
        ).rows;
        const firstRun = rows.find((row) => row.attempt_number === 1);
        const secondRun = rows.find((row) => row.attempt_number === 2);
        if (firstRun === undefined || secondRun === undefined)
          throw new Error('missing BLOCKED_INPUT recovery Runs');
        const first = await h.runUsage(runRefOf(firstRun.run_id));
        const second = await h.runUsage(runRefOf(secondRun.run_id));
        const firstProvenance = first.provenance as CanonicalJsonObject;
        const secondProvenance = second.provenance as CanonicalJsonObject;
        expect(firstProvenance.runRef).toEqual(first.runRef);
        expect(secondProvenance.runRef).toEqual(second.runRef);
        expect(firstProvenance.contextSnapshotRef).not.toEqual(secondProvenance.contextSnapshotRef);
        expect(firstProvenance.resultEvidence).toMatchObject({ presence: 'PRESENT' });
        expect(secondProvenance.resultEvidence).toMatchObject({ presence: 'PRESENT' });
        expect(first.agentDeclaredUsage).toMatchObject({
          presence: 'UNKNOWN',
          reasonCode: 'USAGE_NOT_DECLARED',
        });
        expect(second.agentDeclaredUsage).toMatchObject({
          presence: 'UNKNOWN',
          reasonCode: 'USAGE_NOT_DECLARED',
        });
        // Run-1 history is preserved and independent of the Run-2 read.
        const firstAgain = await h.runUsage(runRefOf(firstRun.run_id));
        const stable = (value: CanonicalJsonObject) => {
          const provenance = { ...(value.provenance as CanonicalJsonObject) };
          delete provenance.snapshotAt;
          return { ...value, provenance };
        };
        expect(stable(firstAgain)).toEqual(stable(first));
      },
      900_000,
    );

    suite.itIntegration(
      'USAGE-D-007 a paused read keeps its old TE snapshot across the owning late-audit commit',
      async () => {
        const h = await usageHarness();
        let paused: Promise<CanonicalJsonObject> | undefined;
        let beforeIsolation: CanonicalJsonObject | undefined;
        let afterIsolation: CanonicalJsonObject | undefined;
        await runScenario(
          'RUN_CANCEL',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'NORMAL',
          false,
          undefined,
          { row: 'IG-CANCEL-D-001', bounded: true, phase: 'CANCELLING' },
          async (stage, runRef) => {
            if (stage === 'CANCELLED') {
              // The original IG final is committed; wait for the read to reach
              // its first Run SELECT (snapshot fixed), then pause it while the
              // owning isolation command commits the LATE_RESULT audit on
              // another connection.
              const reached = h.armGate();
              paused = h.runUsage(runRef);
              paused.catch(() => undefined);
              await reached;
              return;
            }
            if (stage === 'ISOLATED') {
              h.releaseGate();
              beforeIsolation = await (paused ?? Promise.reject(new Error('no paused read')));
              afterIsolation = await h.runUsage(runRef);
            }
          },
        );
        expect(beforeIsolation?.provenance).toMatchObject({
          resultEvidence: { presence: 'UNKNOWN', reasonCode: 'RESULT_NOT_ACCEPTED' },
        });
        expect(afterIsolation?.provenance).toMatchObject({
          resultEvidence: { presence: 'UNKNOWN', reasonCode: 'LATE_RESULT' },
        });
        expect(afterIsolation?.agentDeclaredUsage).toMatchObject({
          presence: 'UNKNOWN',
          reasonCode: 'LATE_RESULT',
        });
      },
      900_000,
    );

    suite.itIntegration(
      'USAGE-D-005 the independent Human read authority gates the whole query',
      async () => {
        const h = await usageHarness();
        const runId = succeededRunId ?? (await latestRunId(['SUCCEEDED']));
        const runRef = runRefOf(runId);
        expect((await h.runUsage(runRef)).agentDeclaredUsage).toMatchObject({
          presence: 'PRESENT',
        });

        // An Agent/SERVICE principal can never obtain the Human Query Decision.
        expect(await h.humanDecisionForAgent(runRef)).toBe('DENY');

        // A Decision issued for another target cannot read this Run.
        await expect(
          h.runUsage(runRef, { decisionTarget: runRefOf(newUuidV7()) }),
        ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
        expect(h.protectedReads()).toEqual([]);

        // A revoked current read authority fails closed with no protected read.
        await expect(h.runUsage(runRef, { revokeAfterIssue: true })).rejects.toMatchObject({
          code: 'AUTHORIZATION_REVOKED',
        });
        expect(h.protectedReads()).toEqual([]);
        await h.restoreGrant('runUsageProvenanceReadHumanV1');
        expect((await h.runUsage(runRef)).agentDeclaredUsage).toMatchObject({
          presence: 'PRESENT',
        });

        // An already-expired Decision is rejected at entry time, before any
        // protected read.
        await expect(h.runUsage(runRef, { expireAfterIssue: true })).rejects.toMatchObject({
          code: 'AUTHORIZATION_REVOKED',
        });
        expect(h.protectedReads()).toEqual([]);
        expect((await h.runUsage(runRef)).agentDeclaredUsage).toMatchObject({
          presence: 'PRESENT',
        });

        // A Decision that expires after the read barrier fails the return
        // checkpoint: the protected reads already ran, but no data is returned.
        await expect(h.runUsage(runRef, { expireAtBarrier: true })).rejects.toMatchObject({
          code: 'AUTHORIZATION_REVOKED',
        });
        expect(h.protectedReads().length).toBeGreaterThan(0);
        expect((await h.runUsage(runRef)).agentDeclaredUsage).toMatchObject({
          presence: 'PRESENT',
        });

        // A revocation after the read barrier fails the return checkpoint: the
        // query has already performed its protected reads, but returns no data.
        await expect(
          h.runUsage(runRef, {
            barrier: async () => h.revokeGrant('runUsageProvenanceReadHumanV1'),
          }),
        ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
        expect(h.protectedReads().length).toBeGreaterThan(0);
        await h.restoreGrant('runUsageProvenanceReadHumanV1');
        expect((await h.runUsage(runRef)).agentDeclaredUsage).toMatchObject({
          presence: 'PRESENT',
        });

        // Each of the five SERVICE dependency authorities is independently
        // required: a missing Grant denies the query and the corresponding
        // protected read never runs.
        const serviceKeys = [
          'runUsageProvenanceSourceReadV1',
          'usageProvenanceContractReadV1',
          'usageProvenanceBindingReadV1',
          'usageProvenanceAdapterIdentityReadV1',
          'usageProvenanceFinalReadV1',
        ] as const;
        const missingReadTable: Partial<Record<(typeof serviceKeys)[number], string>> = {
          usageProvenanceBindingReadV1: 'runtime_attempt',
          usageProvenanceAdapterIdentityReadV1: 'runtime_adapter_identity',
          usageProvenanceFinalReadV1: 'runtime_final_observation',
        };
        for (const key of serviceKeys) {
          await h.revokeGrant(key);
          await expect(h.runUsage(runRef)).rejects.toBeDefined();
          if (key === 'runUsageProvenanceSourceReadV1') {
            expect(h.protectedReads()).toEqual([]);
          } else if (key === 'usageProvenanceContractReadV1') {
            expect(
              h.protectedReads().filter((query) => query.includes('"name":"work_order"')),
            ).toEqual([]);
          } else {
            const table = missingReadTable[key];
            expect(
              h
                .protectedReads()
                .filter((query) => table !== undefined && query.includes(`"name":"${table}"`)),
            ).toEqual([]);
          }
          await h.restoreGrant(key);
        }
        expect((await h.runUsage(runRef)).agentDeclaredUsage).toMatchObject({
          presence: 'PRESENT',
        });
      },
      900_000,
    );

    suite.itIntegration(
      'USAGE-D-006 the Human output is an allowlist without session, prompt or token material',
      async () => {
        const h = await usageHarness();
        const runId = succeededRunId ?? (await latestRunId(['SUCCEEDED']));
        const result = await h.runUsage(runRefOf(runId));
        const serialized = JSON.stringify(result);
        for (const forbidden of [
          'runtimeSessionExternalRef',
          'executionNodeRef',
          'humanSummary',
          'prompt',
          'stdout',
          'workspaceLocator',
          'continuationSecret',
          'runtimeUsageRef',
          'acknowledgedAt',
        ])
          expect(serialized).not.toContain(forbidden);
        const provenance = result.provenance as CanonicalJsonObject;
        expect(Object.keys(provenance).sort()).toEqual([
          'aggregateVersion',
          'attemptEvidence',
          'capabilityGrantRef',
          'contextSnapshotRef',
          'profile',
          'resultEvidence',
          'runRef',
          'runStatus',
          'runtimeBinding',
          'snapshotAt',
          'workOrderContractRef',
        ]);
        expect(h.writes()).toEqual([]);
      },
      900_000,
    );
  },
);
