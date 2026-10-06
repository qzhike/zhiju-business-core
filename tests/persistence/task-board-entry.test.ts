// IM-06 TD-05 (#248): the Task Board read over real owning facts.
//
// These cases create a Task through the real owning creation Command, then read
// `execution.get_task_board_slice@1.0` through the trusted composition entry and
// (for the Projection path) through the finite export/publish pass, so the
// Board evidence comes from committed owning facts, real IdentityPolicy Grants
// and Decisions, and a real published generation.

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  createTaskBoardDispatcher,
  createTaskBoardEntry,
  runTaskBoardExportPass,
  type TaskBoardDispatcherTarget,
} from '@zhiju/api/composition';
import { registeredPolicyProfileReference, type Common } from '@zhiju/contracts';
import {
  TASK_BOARD_BINDINGS,
  createActorSnapshot,
  createTaskBoardAuthorizationPort,
  withIdentityTransaction,
  type IdentityCommandDeps,
  type TaskBoardCapabilityCodes,
} from '@zhiju/identity-policy';
import { digestCanonicalPayload } from '@zhiju/task-execution';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  Kysely,
  PostgresDialect,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
} from 'kysely';
import type pg from 'pg';
import type { TaskExecutionDb } from '@zhiju/task-execution';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postgresImageReference } from '../../tools/persistence/baseline.mjs';
import { runFlyway } from '../../tools/persistence/flyway.mjs';
import {
  AUTH_HASH,
  OPERATOR,
  PROBE_ROLE,
  gateEnabled,
  type Principal,
} from './initial-context-fixtures.js';
import { createInitialContextSuite } from './initial-context-suite.js';

const SERVICE_PRINCIPAL = 'cc01cc01-cc01-7c01-8c01-cc01cc01cc09';
const SERVICE_ACTOR = 'cc02cc02-cc02-7c02-8c02-cc02cc02cc09';
const SERVICE_AUTH = Buffer.alloc(32, 0x39);
const BOARD_PROFILE_KEY = 'execution.task_board.policy@1.0';
const BOARD_PROFILE_REGISTRY_VERSION = 'im06-static-v1';

const container: StartedPostgreSqlContainer | undefined = gateEnabled
  ? await new PostgreSqlContainer(postgresImageReference())
      .withDatabase('zhiju_core')
      .withUsername('postgres')
      .withPassword('zhiju-gate-test')
      .withStartupTimeout(120_000)
      .start()
  : undefined;

beforeAll(async () => {
  await runFlyway(container?.getId() ?? '', {
    command: 'migrate',
    database: 'zhiju_core',
    username: 'postgres',
    password: 'zhiju-gate-test',
  });
}, 600_000);

afterAll(async () => {
  await container?.stop();
}, 120_000);

const BOARD_POLICY_DOCUMENT: CanonicalJsonObject = {
  maxPageSize: 50,
  maxSnapshotRows: 500,
  maxSnapshotBytes: 1_048_576,
  freshnessMaxAgeSeconds: 3600,
  cursorTtlSeconds: 3600,
  refreshIntervalSeconds: 60,
  workerLeaseSeconds: 300,
};

describe.skipIf(!gateEnabled)(
  'Task Board Human read over real owning facts (isolated PostgreSQL)',
  () => {
    const suite = createInitialContextSuite(
      container === undefined ? {} : { databaseUrl: container.getConnectionUri() },
    );

    interface Harness {
      readonly runAuthoritative: (
        payload: CanonicalJsonObject,
        options?: { readonly revokeHuman?: boolean },
      ) => Promise<CanonicalJsonObject>;
      readonly runProjection: (payload: CanonicalJsonObject) => Promise<CanonicalJsonObject>;
      readonly runSnapshotAtLeast: (
        payload: CanonicalJsonObject,
        minimumWatermark: number,
      ) => Promise<CanonicalJsonObject>;
      readonly exportPass: () => Promise<unknown>;
      readonly runExportPassWith: (db: Kysely<TaskExecutionDb>) => Promise<unknown>;
      readonly pool: pg.Pool;
      readonly projectRef: CanonicalJsonObject;
      readonly dirtyCount: () => Promise<number>;
    }

    let harness: Harness | undefined;

    async function boardHarness(): Promise<Harness> {
      if (harness !== undefined) return harness;
      const { enterpriseId, projectId } = suite.fixture;
      const scope = { enterpriseId, projectId };
      const projectRef: CanonicalJsonObject = {
        kind: 'OBJECT',
        objectType: 'zhiju.project.project',
        objectId: projectId,
        scope,
      };
      await suite.admin.query(
        `GRANT platform_context_establisher, task_execution_app, identity_policy_app, projection_app TO ${PROBE_ROLE}`,
      );
      const operator = suite.operator();
      await withIdentityTransaction(suite.identityDb, suite.identityContext([]), async (trx) => {
        try {
          await suite.identityRepo.insertPrincipal(trx, {
            id: SERVICE_PRINCIPAL,
            principalKind: 'SERVICE',
            displayName: 'IM-06 #248 Board source reader',
            createdByPrincipalId: OPERATOR,
            createdByActorSnapshotId: operator.actorSnapshotId,
          });
        } catch {
          // Re-entrant harness construction after a failed first attempt.
        }
      });
      const humanActorRef = await createActorSnapshot(suite.identityDeps([projectId], operator), {
        actorSnapshotId: newUuidV7(),
        principalId: OPERATOR,
        declaredPrincipalKind: 'HUMAN',
        authenticationContextHash: AUTH_HASH,
        scopeKind: 'PROJECT',
        enterpriseId,
        projectId,
      });
      const serviceActorRef = await createActorSnapshot(suite.identityDeps([projectId], operator), {
        actorSnapshotId: SERVICE_ACTOR,
        principalId: SERVICE_PRINCIPAL,
        declaredPrincipalKind: 'SERVICE',
        authenticationContextHash: SERVICE_AUTH,
        scopeKind: 'PROJECT',
        enterpriseId,
        projectId,
      });
      const humanPrincipal: Principal = {
        principalId: OPERATOR,
        principalKind: 'HUMAN',
        actorSnapshotId: humanActorRef.snapshotId,
        actorRef: humanActorRef,
        authHash: AUTH_HASH,
      };
      const servicePrincipal: Principal = {
        principalId: SERVICE_PRINCIPAL,
        principalKind: 'SERVICE',
        actorSnapshotId: serviceActorRef.snapshotId,
        actorRef: serviceActorRef,
        authHash: SERVICE_AUTH,
      };
      const capabilityCodes = Object.fromEntries(
        TASK_BOARD_BINDINGS.map((binding, index) => [
          binding.capabilityConfigKey,
          `wi248.board.c${index}.${SERVICE_PRINCIPAL.replaceAll('-', '')}`,
        ]),
      ) as TaskBoardCapabilityCodes;
      const grantIds = new Map<string, string>();
      for (const binding of TASK_BOARD_BINDINGS) {
        const capabilityCode = capabilityCodes[binding.capabilityConfigKey];
        const base = {
          capabilityCode,
          action: binding.requiredGrantAction,
          selectorType: binding.selectorType,
          targetObjectType: binding.targetObjectTypes[0] ?? '',
          targetObjectTypes: binding.targetObjectTypes,
        } as const;
        grantIds.set(
          binding.capabilityConfigKey,
          await suite.grant(
            binding.expectedPrincipalKind === 'HUMAN'
              ? { ...base, principal: humanPrincipal }
              : base,
          ),
        );
      }
      // The Service principal holds the same grants under its own principal.
      for (const binding of TASK_BOARD_BINDINGS.filter(
        (candidate) => candidate.expectedPrincipalKind === 'SERVICE',
      )) {
        const capabilityCode = capabilityCodes[binding.capabilityConfigKey];
        grantIds.set(
          `${binding.capabilityConfigKey}:service`,
          await suite.grant({
            principal: servicePrincipal,
            capabilityCode,
            action: binding.requiredGrantAction,
            selectorType: binding.selectorType,
            targetObjectType: binding.targetObjectTypes[0] ?? '',
            targetObjectTypes: binding.targetObjectTypes,
          }),
        );
      }
      const profileRef = registeredPolicyProfileReference(
        BOARD_PROFILE_REGISTRY_VERSION,
        BOARD_PROFILE_KEY,
      );
      if (profileRef === undefined) throw new Error('the Board profile is not registered');
      const boardPolicyRef: Common.VersionedRef = {
        kind: 'VERSIONED',
        objectType: 'zhiju.identity.policy',
        objectId: newUuidV7(),
        versionId: newUuidV7(),
        scope,
      };
      await suite.registerPolicyVersionAs({
        key: boardPolicyRef,
        factId: newUuidV7(),
        idempotencyKey: 'wi248',
        effectiveFrom: new Date(Date.now() - 86_400_000),
        policySchemaRefs: [profileRef],
        policyDocument: BOARD_POLICY_DOCUMENT,
      });

      const auth = createTaskBoardAuthorizationPort({ capabilityCodes });
      const humanDeps = suite.identityDeps([projectId], humanPrincipal);
      const serviceDeps = suite.identityDeps([projectId], servicePrincipal);
      const mint = async (
        deps: IdentityCommandDeps,
        key: 'taskBoardReadHumanV1' | 'taskBoardSourceReadV1',
        commandType: string,
        actorSnapshotRef: Common.SnapshotRef,
        authenticationContextHash: Buffer,
        payload: CanonicalJsonObject,
      ) => {
        const issued = await auth.authorize(deps, key, {
          actorSnapshotRef,
          commandType,
          commandVersion: '1.0',
          commandPayloadHash: digestCanonicalPayload(payload).hash,
          authenticationContextHash,
          targetRef: projectRef as unknown as Common.ObjectRef,
        });
        if (issued.outcome !== 'ALLOW') throw new Error(`Board ${key} was denied`);
        return issued.authorizationDecisionRef;
      };
      const entry = createTaskBoardEntry({
        identity: { db: suite.identityDb, repo: suite.identityRepo, crypto: suite.crypto },
        taskExecutionDb: suite.teDb,
        capabilityCodes,
        cursorKey: { keyId: 11, secret: Buffer.alloc(32, 0x31) },
        boardPolicyRef: (candidate) => (candidate === projectId ? boardPolicyRef : undefined),
      });
      const dispatcher = createTaskBoardDispatcher({
        identity: { db: suite.identityDb, repo: suite.identityRepo, crypto: suite.crypto },
        taskExecutionDb: suite.teDb,
        capabilityCodes,
        workerOwner: 'wi248-board-worker',
        boardPolicyRef: (candidate) => (candidate === projectId ? boardPolicyRef : undefined),
        targets: [
          {
            projectRef,
            scope,
            serviceSession: {
              authenticationContextHash: SERVICE_AUTH,
              resolutionActorSnapshotRef: serviceActorRef,
              bootstrapDecisionRef: await mint(
                serviceDeps,
                'taskBoardSourceReadV1',
                'execution.task_board.source.read.v1',
                serviceActorRef,
                SERVICE_AUTH,
                { projectRef },
              ),
            },
          },
        ],
      });
      const humanActorSnapshotRef = humanActorRef;
      const bootstrapSourceDecision = await mint(
        serviceDeps,
        'taskBoardSourceReadV1',
        'execution.task_board.source.read.v1',
        serviceActorRef,
        SERVICE_AUTH,
        { projectRef },
      );
      const target: TaskBoardDispatcherTarget = {
        projectRef,
        scope,
        serviceSession: {
          authenticationContextHash: SERVICE_AUTH,
          resolutionActorSnapshotRef: serviceActorRef,
          bootstrapDecisionRef: bootstrapSourceDecision,
        },
      };
      const runBoard = async (
        payload: CanonicalJsonObject,
        consistency: string,
        revokeHuman = false,
        minimumWatermark?: number,
      ): Promise<CanonicalJsonObject> => {
        const humanDecisionRef = await mint(
          humanDeps,
          'taskBoardReadHumanV1',
          'execution.get_task_board_slice',
          humanActorSnapshotRef,
          AUTH_HASH,
          payload,
        );
        if (revokeHuman) {
          const result = await suite.revokeCapabilityTracked(humanDeps, {
            targetId: grantIds.get('taskBoardReadHumanV1') ?? '',
            expectedAggregateVersion: '1',
            scope: { scopeKind: 'PROJECT', enterpriseId, projectId },
            reasonCode: 'WI248_REVIEW',
            effectiveAt: new Date(),
            idempotencyKey: `wi248-revoke-${newUuidV7()}`,
          });
          expect(result.status).toBe('COMMITTED');
        }
        return entry.getTaskBoardSlice(
          {
            queryId: newUuidV7(),
            queryType: 'execution.get_task_board_slice',
            queryVersion: '1.0',
            scopeRef: scope,
            requester: {
              kind: 'OBJECT',
              objectType: 'zhiju.identity.principal',
              objectId: OPERATOR,
              scope,
            },
            authenticationContextRef: {
              kind: 'CONTENT_ADDRESSED',
              objectType: 'zhiju.identity.authentication_context',
              objectId: humanActorSnapshotRef.snapshotId,
              scope,
              contentHash: {
                algorithm: 'SHA-256',
                canonicalizationVersion: '1',
                digest: AUTH_HASH.toString('hex'),
              },
            },
            authorizationDecisionRef: humanDecisionRef as unknown as CanonicalJsonObject,
            consistencyRequirement: consistency,
            ...(minimumWatermark === undefined ? {} : { minimumWatermark }),
            correlationId: newUuidV7(),
            requestedAt: new Date().toISOString(),
            payload,
          },
          {
            authenticationContextHash: AUTH_HASH,
            resolutionActorSnapshotRef: humanActorSnapshotRef,
            serviceSession: {
              authenticationContextHash: SERVICE_AUTH,
              resolutionActorSnapshotRef: serviceActorRef,
              sourceDecisionRef: bootstrapSourceDecision,
            },
          },
        );
      };
      harness = {
        runAuthoritative: (payload, options) =>
          runBoard(payload, 'AUTHORITATIVE', options?.revokeHuman === true),
        runProjection: (payload) => runBoard(payload, 'PROJECTION_OK'),
        runSnapshotAtLeast: (payload, minimumWatermark) =>
          runBoard(payload, 'SNAPSHOT_AT_LEAST', false, minimumWatermark),
        runExportPassWith: async (db) => {
          const prepared = await dispatcher.prepare(target);
          return runTaskBoardExportPass(
            { taskExecutionDb: db, workerOwner: 'wi248-board-worker' },
            prepared,
            prepared.ports,
          );
        },
        exportPass: () => dispatcher.runExportPass(target),
        pool: suite.tePool,
        projectRef,
        dirtyCount: async () =>
          Number(
            (
              await suite.admin.query<{ count: string }>(
                `SELECT count(*)::text AS count FROM task_execution.task_board_dirty WHERE project_id = $1`,
                [projectId],
              )
            ).rows[0]?.count ?? '0',
          ),
      };
      return harness;
    }

    it('reads a real owning Task through the AUTHORITATIVE Board entry', async () => {
      const board = await boardHarness();
      const taskId = await suite.createExecutableTask('2.0');
      const result = await board.runAuthoritative({
        projectRef: board.projectRef,
        statuses: ['DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED'],
        page: { pageSize: 50 },
      });
      expect(result.status).toBe('OK');
      expect(result.stalenessStatus).toBe('FRESH');
      const page = result.data as Record<string, unknown>;
      expect(page.sourceWatermarks).toEqual([]);
      const items = page.items as Record<string, unknown>[];
      expect(
        items.some((item) => (item.taskRef as Record<string, unknown>).objectId === taskId),
      ).toBe(true);
      const item = items.find(
        (candidate) => (candidate.taskRef as Record<string, unknown>).objectId === taskId,
      );
      expect(typeof item?.title).toBe('string');
      expect(['DRAFT', 'READY']).toContain(item?.status);
    });

    it('exports, publishes and serves the Projection path with real dirty coverage', async () => {
      const board = await boardHarness();
      expect(await board.dirtyCount()).toBeGreaterThan(0);
      const published = (await board.exportPass()) as { publishSequence: number } | undefined;
      expect(published?.publishSequence).toBeGreaterThanOrEqual(1);
      expect(await board.dirtyCount()).toBe(0);
      const result = await board.runProjection({
        projectRef: board.projectRef,
        statuses: ['DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED'],
        page: { pageSize: 50 },
      });
      expect(result.status).toBe('OK');
      expect(result.stalenessStatus).toBe('FRESH');
      const page = result.data as Record<string, unknown>;
      const watermarks = page.sourceWatermarks as Record<string, unknown>[];
      expect(watermarks).toHaveLength(1);
      expect(watermarks[0]?.sourceModule).toBe('task_execution');
      expect(watermarks[0]?.sequence).toBe(published?.publishSequence);
    });
    it('keeps both Task creation identities and serves SNAPSHOT_AT_LEAST', async () => {
      const board = await boardHarness();
      const legacyTaskId = await suite.createExecutableTask('1.0');
      const authoritative = await board.runAuthoritative({
        projectRef: board.projectRef,
        statuses: ['DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED'],
        page: { pageSize: 50 },
      });
      const items = (authoritative.data as Record<string, unknown>).items as Record<
        string,
        unknown
      >[];
      const legacy = items.find(
        (item) => (item.taskRef as Record<string, unknown>).objectId === legacyTaskId,
      );
      expect((legacy?.taskRef as Record<string, unknown>).objectType).toBe('execution.task');
      expect(
        items.some(
          (item) => (item.taskRef as Record<string, unknown>).objectType === 'zhiju.execution.task',
        ),
      ).toBe(true);
      // SNAPSHOT_AT_LEAST at or above the published watermark serves data, and
      // an unreachable watermark is a data-less STALE page.
      const published = (await board.exportPass()) as { publishSequence: number } | undefined;
      const atLeast = await board.runSnapshotAtLeast(
        {
          projectRef: board.projectRef,
          statuses: ['DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED'],
          page: { pageSize: 50 },
        },
        0,
      );
      expect(atLeast.status).toBe('OK');
      expect(atLeast.data).toBeDefined();
      const unmet = await board.runSnapshotAtLeast(
        {
          projectRef: board.projectRef,
          statuses: ['DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED'],
          page: { pageSize: 50 },
        },
        (published?.publishSequence ?? 0) + 5,
      );
      expect(unmet.status).toBe('STALE');
      expect(unmet.data).toBeUndefined();
    });

    it('binds the WorkOrder identity of a real owning WorkOrder', async () => {
      const board = await boardHarness();
      const taskId = await suite.createExecutableTask('2.0');
      const workOrderId = await suite.createWorkOrder({ taskId, taskMajor: '2.0' });
      const result = await board.runAuthoritative({
        projectRef: board.projectRef,
        statuses: ['DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED'],
        page: { pageSize: 50 },
      });
      const items = (result.data as Record<string, unknown>).items as Record<string, unknown>[];
      const item = items.find(
        (candidate) => (candidate.taskRef as Record<string, unknown>).objectId === taskId,
      );
      expect(item).toBeDefined();
      const workOrders = item?.activeWorkOrderRefs as Record<string, unknown>[];
      expect(
        workOrders.some(
          (ref) => ref.objectId === workOrderId && ref.objectType === 'zhiju.execution.work_order',
        ),
      ).toBe(true);
    });

    it('walks the complete old cursor after the source changes and G2 replaces the alias', async () => {
      const board = await boardHarness();
      // Only the first page of G1 is read before the mutation.
      const first = await board.runProjection({
        projectRef: board.projectRef,
        statuses: ['DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED'],
        page: { pageSize: 1 },
      });
      const firstItems = (first.data as Record<string, unknown>).items as Record<string, unknown>[];
      const firstPageIds = firstItems.map((item) =>
        String((item.taskRef as Record<string, unknown>).objectId),
      );
      const cursor = String((first.data as Record<string, unknown>).nextCursor);
      expect(cursor).not.toBe('undefined');
      // The owning source changes and G2 replaces the alias.
      const newTaskId = await suite.createExecutableTask('2.0');
      await board.exportPass();
      // The *complete* G1 traversal now happens through the old cursor.
      const seen = [...firstPageIds];
      let next: string | undefined = cursor;
      for (let page = 0; next !== undefined && page < 50; page += 1) {
        const result = await board.runProjection({
          projectRef: board.projectRef,
          statuses: ['DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED'],
          page: { pageSize: 1, cursor: next },
        });
        expect(result.stalenessStatus).toBe('STALE');
        const items = (result.data as Record<string, unknown>).items as Record<string, unknown>[];
        seen.push(
          ...items.map((item) => String((item.taskRef as Record<string, unknown>).objectId)),
        );
        next =
          (result.data as Record<string, unknown>).nextCursor === undefined
            ? undefined
            : String((result.data as Record<string, unknown>).nextCursor);
      }
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).not.toContain(newTaskId);
      // After the walk the current generation (G2) owns the new row.
      const g2 = await board.runProjection({
        projectRef: board.projectRef,
        statuses: ['DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED'],
        page: { pageSize: 50 },
      });
      const g2Ids = ((g2.data as Record<string, unknown>).items as Record<string, unknown>[]).map(
        (item) => String((item.taskRef as Record<string, unknown>).objectId),
      );
      expect(g2Ids).toContain(newTaskId);
      expect(g2Ids.length).toBeGreaterThan(seen.length);
    });

    it('does not cover an owning write that commits after the export read its dirty boundary', async () => {
      const board = await boardHarness();
      await board.exportPass();
      expect(await board.dirtyCount()).toBe(0);
      // A real owning producer runs while the export is parked at its dirty
      // read boundary, so the export's REPEATABLE READ snapshot predates the
      // produced marker and must not cover it.
      const reached = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      let dirtyReadSeen = false;
      let released = false;
      const probeDb = new Kysely<TaskExecutionDb>({
        dialect: new PostgresDialect({ pool: board.pool }),
        plugins: [
          {
            transformQuery(args: PluginTransformQueryArgs) {
              if (!dirtyReadSeen && JSON.stringify(args.node).includes('task_board_dirty'))
                dirtyReadSeen = true;
              return args.node;
            },
            async transformResult(args: PluginTransformResultArgs) {
              // Park the export after its dirty read has been executed, so a
              // concurrently committed owning write stays outside it.
              if (dirtyReadSeen && !released) {
                released = true;
                reached.resolve(true);
                await release.promise;
              }
              return args.result;
            },
          },
        ],
      });
      const exported = board.runExportPassWith(probeDb);
      await reached.promise;
      // The real owning command commits its produced dirty identity while the
      // export is still parked.
      const producedTaskId = await suite.createExecutableTask('2.0');
      release.resolve(true);
      const result = (await exported) as { publishSequence: number } | undefined;
      expect(result?.publishSequence).toBeGreaterThanOrEqual(1);
      // Not covered by that export: it stays pending and the next export
      // covers it.
      expect(await board.dirtyCount()).toBeGreaterThan(0);
      await board.exportPass();
      expect(await board.dirtyCount()).toBe(0);
      expect(producedTaskId.length).toBeGreaterThan(0);
    });

    it('refuses the read once the Human Grant is revoked', async () => {
      const board = await boardHarness();
      await expect(
        board.runAuthoritative(
          {
            projectRef: board.projectRef,
            statuses: ['DRAFT'],
            page: { pageSize: 10 },
          },
          { revokeHuman: true },
        ),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
    });
  },
);
