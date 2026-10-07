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
  type TaskBoardCapabilityKey,
  type IdentityPolicyDb,
} from '@zhiju/identity-policy';
import { digestCanonicalPayload } from '@zhiju/task-execution';
import { canonicalize, newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  Kysely,
  PostgresDialect,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type KyselyPlugin,
  type QueryId,
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
import { createRunScenario } from './initial-context-scenario.js';
import type { ScenarioBoardProbe } from './initial-context-scenario-types.js';

const SERVICE_PRINCIPAL = 'cc01cc01-cc01-7c01-8c01-cc01cc01cc09';
const SERVICE_ACTOR = 'cc02cc02-cc02-7c02-8c02-cc02cc02cc09';
const SERVICE_AUTH = Buffer.alloc(32, 0x39);
const BOARD_STATUSES = [
  'DRAFT',
  'BACKLOG',
  'READY',
  'IN_PROGRESS',
  'WAITING_INPUT',
  'BLOCKED',
  'IN_REVIEW',
  'CHANGES_REQUIRED',
  'COMPLETION_PENDING',
  'COMPLETED',
  'CANCELLED',
];
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

    function boardScope(board: { readonly projectRef: CanonicalJsonObject }): {
      readonly enterpriseId: string;
      readonly projectId: string;
    } {
      const scope = board.projectRef.scope as Record<string, unknown> | undefined;
      return {
        enterpriseId: String(scope?.enterpriseId),
        projectId: String(scope?.projectId),
      };
    }

    interface Harness {
      readonly probeMapping: (
        key: TaskBoardCapabilityKey,
        missing?: 'GRANT' | 'CONFIG',
      ) => Promise<{ outcome: unknown; protectedQueries: readonly string[] }>;
      readonly readAtBoundary: (
        payload: CanonicalJsonObject,
        consistency: string,
        change: TaskBoardCapabilityKey | 'EXPIRE' | 'POLICY_SUPERSEDED',
      ) => Promise<{ outcome: unknown; reached: boolean; currentIdentityReads: number }>;

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
      /** Runs the real pass but aborts at the confirm authorization. */
      /** Revokes the Service source-read authority of this Project. */
      readonly revokeSourceAuthority: () => Promise<void>;
      /**
       * Runs the entry with the supplied Board Policy resolution, counting every
       * statement the entry issues against the Task Execution pool.
       */
      readonly runWithPolicyProbe: (
        payload: CanonicalJsonObject,
        configured: boolean,
      ) => Promise<{ outcome: unknown; queries: number }>;
      readonly runExportPassCrashingBeforeConfirm: () => Promise<{
        readonly exportId: string;
        readonly dirtyIds: readonly string[];
      }>;
      /** Runs the read through an entry bound to the supplied Task Execution handle. */
      readonly runWithProbe: (
        payload: CanonicalJsonObject,
        consistency: string,
        db: Kysely<TaskExecutionDb>,
      ) => Promise<CanonicalJsonObject>;
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
      let boardPolicyRef: Common.VersionedRef = {
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
      let bootstrapSourceDecision = await mint(
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
        db?: Kysely<TaskExecutionDb>,
        options: {
          readonly codes?: TaskBoardCapabilityCodes;
          readonly identityDb?: Kysely<IdentityPolicyDb>;
          readonly now?: () => Date;
          readonly beforeEntry?: (decision: Common.ContentAddressedRef) => Promise<void>;
        } = {},
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
        await options.beforeEntry?.(humanDecisionRef);
        const activeEntry = createTaskBoardEntry({
          identity: {
            db: options.identityDb ?? suite.identityDb,
            repo: suite.identityRepo,
            crypto: suite.crypto,
          },
          taskExecutionDb: db ?? suite.teDb,
          capabilityCodes: options.codes ?? capabilityCodes,
          cursorKey: { keyId: 11, secret: Buffer.alloc(32, 0x31) },
          boardPolicyRef: (candidate) => (candidate === projectId ? boardPolicyRef : undefined),
          ...(options.now === undefined ? {} : { now: options.now }),
        });
        return activeEntry.getTaskBoardSlice(
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
      const bindingOf = (key: TaskBoardCapabilityKey) => {
        const binding = TASK_BOARD_BINDINGS.find(
          (candidate) => candidate.capabilityConfigKey === key,
        );
        if (binding === undefined) throw new Error(`missing Board binding ${key}`);
        return binding;
      };
      const grantKey = (key: TaskBoardCapabilityKey) =>
        key === 'taskBoardReadHumanV1' ? key : `${key}:service`;
      const revokeGrant = async (key: TaskBoardCapabilityKey): Promise<void> => {
        const binding = bindingOf(key);
        expect(
          await suite.revokeCapabilityTracked(
            binding.expectedPrincipalKind === 'HUMAN' ? humanDeps : serviceDeps,
            {
              targetId: grantIds.get(grantKey(key)) ?? '',
              expectedAggregateVersion: '1',
              scope: { scopeKind: 'PROJECT', enterpriseId, projectId },
              reasonCode: 'WI248_BOARD_BOUNDARY_REVOKE',
              effectiveAt: new Date(),
              idempotencyKey: newUuidV7(),
            },
          ),
        ).toMatchObject({ status: 'COMMITTED' });
      };
      const restoreGrant = async (key: TaskBoardCapabilityKey): Promise<void> => {
        const binding = bindingOf(key);
        grantIds.set(
          grantKey(key),
          await suite.grant({
            principal:
              binding.expectedPrincipalKind === 'HUMAN' ? humanPrincipal : servicePrincipal,
            capabilityCode: capabilityCodes[key],
            action: binding.requiredGrantAction,
            selectorType: binding.selectorType,
            targetObjectType: binding.targetObjectTypes[0] ?? '',
            targetObjectTypes: binding.targetObjectTypes,
          }),
        );
        if (key === 'taskBoardSourceReadV1') {
          bootstrapSourceDecision = await mint(
            serviceDeps,
            key,
            'execution.task_board.source.read.v1',
            serviceActorRef,
            SERVICE_AUTH,
            { projectRef },
          );
        }
      };
      const capture = async (execute: () => Promise<unknown>): Promise<unknown> =>
        execute().then(
          (value) => value,
          (error: unknown) => error,
        );
      const query = { projectRef, statuses: BOARD_STATUSES, page: { pageSize: 50 } };
      const queryLog = (statements: string[]): KyselyPlugin => ({
        transformQuery(args) {
          statements.push(
            JSON.stringify(args.node, (key, value: unknown) =>
              key === 'value' || key === 'values' ? undefined : value,
            ),
          );
          return args.node;
        },
        transformResult: (args) => Promise.resolve(args.result),
      });
      const protectedBy = (key: TaskBoardCapabilityKey, statements: readonly string[]) => {
        // Count only this mapping's protected statements, including attempted
        // writes. Context setup and other independently authorized steps are
        // deliberately outside this counter.
        const table = {
          taskBoardReadHumanV1: 'task_execution',
          taskBoardSourceReadV1: 'task_execution',
          taskBoardHealthReadV1: 'task_board_health',
          taskBoardPolicyReadV1: 'policy_version',
          taskBoardDispatchManageV1: 'task_board_dispatch_',
          taskBoardProjectionPublishV1: 'projection',
          taskBoardProjectionMaintainV1: 'task_board_generation',
        }[key];
        return statements.filter((statement) => statement.includes(table));
      };
      harness = {
        probeMapping: async (key, missing) => {
          const statements: string[] = [];
          const plugin = queryLog(statements);
          const db = suite.teDb.withPlugin(plugin);
          const identityDb = suite.identityDb.withPlugin(plugin);
          const codes = missing === 'CONFIG' ? { ...capabilityCodes, [key]: '' } : capabilityCodes;
          const technical = [
            'taskBoardDispatchManageV1',
            'taskBoardProjectionPublishV1',
            'taskBoardProjectionMaintainV1',
          ].includes(key);
          const activeDispatcher = createTaskBoardDispatcher({
            identity: { db: identityDb, repo: suite.identityRepo, crypto: suite.crypto },
            taskExecutionDb: db,
            capabilityCodes: codes,
            workerOwner: 'wi248-board-worker',
            boardPolicyRef: (candidate) => (candidate === projectId ? boardPolicyRef : undefined),
            targets: [target],
          });
          if (missing === 'GRANT' && key !== 'taskBoardReadHumanV1') await revokeGrant(key);
          try {
            const outcome = await capture(() =>
              technical
                ? key === 'taskBoardProjectionMaintainV1'
                  ? activeDispatcher.runMaintenancePass(target)
                  : activeDispatcher.runExportPass(target)
                : runBoard(
                    query,
                    key === 'taskBoardHealthReadV1' ? 'PROJECTION_OK' : 'AUTHORITATIVE',
                    false,
                    undefined,
                    db,
                    {
                      codes,
                      identityDb,
                      ...(missing === 'GRANT' && key === 'taskBoardReadHumanV1'
                        ? { beforeEntry: () => revokeGrant(key) }
                        : {}),
                    },
                  ),
            );
            return { outcome, protectedQueries: protectedBy(key, statements) };
          } finally {
            if (missing === 'GRANT') await restoreGrant(key);
          }
        },
        readAtBoundary: async (payload, consistency, change) => {
          const statements: string[] = [];
          let queryId: QueryId | undefined;
          const state = { reached: false };
          let clock: number | undefined;
          let expiry = Date.now();
          let replacement: Common.VersionedRef | undefined;
          const db = suite.teDb.withPlugin({
            transformQuery(args) {
              const node = JSON.stringify(args.node);
              const table =
                consistency === 'AUTHORITATIVE'
                  ? '"name":"task"'
                  : '"name":"task_board_generation"';
              if (!state.reached && node.includes(table)) queryId = args.queryId;
              return args.node;
            },
            async transformResult(args) {
              if (queryId === args.queryId && !state.reached) {
                state.reached = true;
                queryId = undefined;
                // This result hook is reached after a business SELECT has
                // established the TE snapshot. Revocation commits through an
                // independent owning IP transaction before returning its rows.
                if (change === 'EXPIRE') clock = expiry;
                else if (change === 'POLICY_SUPERSEDED') {
                  replacement = { ...boardPolicyRef, versionId: newUuidV7() };
                  await suite.registerPolicyVersionAs({
                    key: replacement,
                    factId: newUuidV7(),
                    idempotencyKey: newUuidV7(),
                    effectiveFrom: new Date(),
                    supersedesRef: boardPolicyRef,
                    policySchemaRefs: [profileRef],
                    policyDocument: BOARD_POLICY_DOCUMENT,
                  });
                } else await revokeGrant(change);
                statements.length = 0;
              }
              return args.result;
            },
          });
          try {
            const outcome = await capture(() =>
              runBoard(payload, consistency, false, undefined, db, {
                identityDb: suite.identityDb.withPlugin(queryLog(statements)),
                now: () => new Date(clock ?? Date.now()),
                beforeEntry: async (decision) => {
                  const row = (
                    await suite.admin.query<{ expires_at: Date }>(
                      'SELECT expires_at FROM identity_policy.authorization_decision WHERE authorization_decision_id=$1',
                      [decision.objectId],
                    )
                  ).rows[0];
                  if (row === undefined) throw new Error('missing Human Decision expiry');
                  expiry = row.expires_at.getTime() + 1;
                },
              }),
            );
            return {
              outcome,
              reached: state.reached,
              currentIdentityReads: statements.filter((node) => node.includes('capability_grant'))
                .length,
            };
          } finally {
            if (replacement !== undefined) boardPolicyRef = replacement;
            else if (state.reached && change !== 'EXPIRE' && change !== 'POLICY_SUPERSEDED')
              await restoreGrant(change);
          }
        },
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
        runWithPolicyProbe: async (payload, configured) => {
          const counter = { queries: 0 };
          const countingDb = new Kysely<TaskExecutionDb>({
            dialect: new PostgresDialect({ pool: suite.tePool }),
            plugins: [
              {
                transformQuery: (args: PluginTransformQueryArgs) => {
                  counter.queries += 1;
                  return args.node;
                },
                transformResult: (args: PluginTransformResultArgs) => Promise.resolve(args.result),
              },
            ],
          });
          const probed = createTaskBoardEntry({
            identity: { db: suite.identityDb, repo: suite.identityRepo, crypto: suite.crypto },
            taskExecutionDb: countingDb,
            capabilityCodes,
            cursorKey: { keyId: 11, secret: Buffer.alloc(32, 0x31) },
            boardPolicyRef: (candidate) =>
              configured && candidate === projectId ? boardPolicyRef : undefined,
          });
          const humanDecisionRef = await mint(
            humanDeps,
            'taskBoardReadHumanV1',
            'execution.get_task_board_slice',
            humanActorSnapshotRef,
            AUTH_HASH,
            payload,
          );
          const outcome = await probed
            .getTaskBoardSlice(
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
                consistencyRequirement: 'AUTHORITATIVE',
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
            )
            .then(
              (value) => value as unknown,
              (error: unknown) => error,
            );
          return { outcome, queries: counter.queries };
        },
        revokeSourceAuthority: async () => {
          const sourceGrantId = grantIds.get('taskBoardSourceReadV1:service');
          if (sourceGrantId === undefined) throw new Error('the source Grant is missing');
          const result = await suite.revokeCapabilityTracked(serviceDeps, {
            targetId: sourceGrantId,
            expectedAggregateVersion: '1',
            scope: { scopeKind: 'PROJECT', enterpriseId, projectId },
            reasonCode: 'WI248_REVIEW',
            effectiveAt: new Date(),
            idempotencyKey: `wi248-revoke-source-${newUuidV7()}`,
          });
          expect(result.status).toBe('COMMITTED');
        },
        runExportPassCrashingBeforeConfirm: async () => {
          const prepared = await dispatcher.prepare(target);
          let captured: { exportId: string; dirtyIds: readonly string[] } | undefined;
          const crashingPorts = {
            resolvePolicy: prepared.ports.resolvePolicy,
            authorize: async (
              boundary: Parameters<typeof prepared.ports.authorize>[0],
              ref: Parameters<typeof prepared.ports.authorize>[1],
              payload: Parameters<typeof prepared.ports.authorize>[2],
            ) => {
              if (boundary === 'taskBoardDispatchManageV1' && payload.operation === 'CONFIRM') {
                captured = {
                  exportId: typeof payload.exportId === 'string' ? payload.exportId : '',
                  dirtyIds: (payload.coveredDirtyIds ?? []) as readonly string[],
                };
                throw new Error('simulated worker crash before the confirmation');
              }
              return prepared.ports.authorize(boundary, ref, payload);
            },
          };
          await expect(
            runTaskBoardExportPass(
              { taskExecutionDb: suite.teDb, workerOwner: 'wi248-board-worker' },
              prepared,
              crashingPorts,
            ),
          ).rejects.toThrow('simulated worker crash before the confirmation');
          if (captured === undefined) throw new Error('the crash point was not reached');
          return captured;
        },
        exportPass: () => dispatcher.runExportPass(target),
        runWithProbe: (payload, consistency, db) =>
          runBoard(payload, consistency, false, undefined, db),
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

    const runScenario = createRunScenario(suite);
    const boardPayload = (board: Harness): CanonicalJsonObject => ({
      projectRef: board.projectRef,
      statuses: BOARD_STATUSES,
      page: { pageSize: 50 },
    });
    const sortedRefs = (refs: CanonicalJsonObject[]) =>
      refs.sort((left, right) =>
        Buffer.compare(Buffer.from(canonicalize(left)), Buffer.from(canonicalize(right))),
      );

    /** Independent expected public row from the committed owning mirrors. */
    async function expectedItem(taskId: string, blocked: boolean): Promise<CanonicalJsonObject> {
      const scope = suite.scope();
      const task = (
        await suite.admin.query<{
          status: string;
          aggregate_version: string;
          schema_version: string;
          canonical_payload: CanonicalJsonObject;
          current_completion_evaluation_id: string | null;
          evaluation_hash: string | null;
        }>(
          `SELECT t.status,t.aggregate_version,d.schema_version,d.canonical_payload,
        t.current_completion_evaluation_id,encode(t.current_completion_evaluation_hash,'hex') AS evaluation_hash
        FROM task_execution.task t JOIN task_execution.task_definition_snapshot d
        ON d.snapshot_id=t.current_definition_snapshot_id WHERE t.task_id=$1`,
          [taskId],
        )
      ).rows[0];
      if (task === undefined) throw new Error('missing owning Task');
      const ref = (objectType: string, objectId: string): CanonicalJsonObject => ({
        kind: 'OBJECT',
        objectType,
        objectId,
        scope,
      });
      const workOrders = (
        await suite.admin.query<{
          work_order_id: string;
          work_order_object_type: string;
          status: string;
        }>(
          'SELECT work_order_id,work_order_object_type,status FROM task_execution.work_order WHERE task_id=$1 ORDER BY work_order_id',
          [taskId],
        )
      ).rows;
      const requests = (
        await suite.admin.query<{ request_id: string }>(
          `SELECT q.request_id FROM task_execution.information_request q
        JOIN task_execution.work_order w USING(work_order_id) WHERE w.task_id=$1
        AND q.status<>'RESOLVED' AND q.definition->>'blocking'='true' ORDER BY q.request_id`,
          [taskId],
        )
      ).rows;
      const blockers = requests.map((row) => ref('execution.information_request', row.request_id));
      if (blocked) {
        expect(workOrders).toHaveLength(1);
        for (const row of workOrders)
          blockers.push(ref(row.work_order_object_type, row.work_order_id));
      }
      const title = (task.canonical_payload.definition as CanonicalJsonObject).title;
      if (typeof title !== 'string') throw new Error('missing owning Task title');
      return {
        taskRef: ref(
          task.schema_version === '1.0' ? 'execution.task' : 'zhiju.execution.task',
          taskId,
        ),
        aggregateVersion: Number(task.aggregate_version),
        title,
        status: task.status,
        activeWorkOrderRefs: sortedRefs(
          workOrders
            .filter((row) =>
              [
                'DRAFT',
                'READY',
                'QUEUED',
                'RUNNING',
                'WAITING_INPUT',
                'COMPLETION_PENDING',
                'RETRY_PENDING',
              ].includes(row.status),
            )
            .map((row) => ref(row.work_order_object_type, row.work_order_id)),
        ),
        blockerRefs: sortedRefs(blockers),
        ...(task.current_completion_evaluation_id === null
          ? {}
          : {
              completionEvaluationRef: {
                kind: 'CONTENT_ADDRESSED',
                objectType: 'zhiju.execution.completion_evaluation',
                objectId: task.current_completion_evaluation_id,
                scope,
                contentHash: {
                  algorithm: 'SHA-256',
                  canonicalizationVersion: '1',
                  digest: task.evaluation_hash,
                },
              },
            }),
      };
    }
    async function taskForRun(runRef: Common.ObjectRef): Promise<string> {
      const row = (
        await suite.admin.query<{ task_id: string }>(
          'SELECT w.task_id FROM task_execution.run r JOIN task_execution.work_order w USING(work_order_id) WHERE r.run_id=$1',
          [runRef.objectId],
        )
      ).rows[0];
      if (row === undefined) throw new Error('missing Run owning Task');
      return row.task_id;
    }
    async function assertBoardItem(board: Harness, taskId: string, blocked: boolean) {
      const expected = await expectedItem(taskId, blocked);
      const result = await board.runAuthoritative(boardPayload(board));
      expect(result.status).toBe('OK');
      const items = (result.data as CanonicalJsonObject).items as CanonicalJsonObject[];
      expect(
        items.find((item) => (item.taskRef as CanonicalJsonObject).objectId === taskId),
      ).toEqual(expected);
      return expected;
    }

    suite.itIntegration(
      'BOARD-D-001 real DRAFT/READY, normal completion and current Evaluation',
      async () => {
        const board = await boardHarness();
        for (const major of ['1.0', '2.0'] as const) {
          const draftId = await suite.createExecutableTask(major, false, undefined, true);
          expect((await assertBoardItem(board, draftId, false)).status).toBe('DRAFT');
        }
        const readyId = await suite.createExecutableTask('2.0', true);
        expect((await assertBoardItem(board, readyId, false)).status).toBe('READY');
        const seen: string[] = [];
        const probe: ScenarioBoardProbe = async (stage, runRef) => {
          const taskId = await taskForRun(runRef);
          const item = await assertBoardItem(board, taskId, false);
          seen.push(stage);
          if (stage === 'RUN_FINALIZED') {
            expect(item.status).not.toBe('COMPLETED');
            expect(item.completionEvaluationRef).toBeUndefined();
            expect(item.activeWorkOrderRefs).toHaveLength(1);
          }
          if (stage === 'COMPLETED') {
            expect(item.status).toBe('COMPLETED');
            expect(item.activeWorkOrderRefs).toEqual([]);
            expect(item.blockerRefs).toEqual([]);
            expect(item.completionEvaluationRef).toBeDefined();
            // The Board exposes only the current immutable reference, never a
            // derived USABLE claim or the full Completion judgment.
            expect(item).not.toHaveProperty('useStatus');
          }
        };
        await runScenario(
          'FORMAL_NORMAL',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'NORMAL',
          false,
          undefined,
          undefined,
          undefined,
          probe,
        );
        expect(seen).toEqual(['FINAL_RESERVED', 'RUN_FINALIZED', 'COMPLETED']);
      },
    );

    suite.itIntegration(
      'BOARD-D-001/005 real BLOCKED_INPUT recovery and complete Export RR rows',
      async () => {
        const board = await boardHarness();
        const seen: string[] = [];
        let oldItems: CanonicalJsonObject[] = [];
        let pendingExport: ReturnType<Harness['runExportPassWith']> | undefined;
        let release: (() => void) | undefined;
        let reached = false;
        let queryId: QueryId | undefined;
        const probe: ScenarioBoardProbe = async (stage, runRef) => {
          const taskId = await taskForRun(runRef);
          const blocked = !['RECOVERY_SUCCEEDED', 'COMPLETED'].includes(stage);
          const item = await assertBoardItem(board, taskId, blocked);
          seen.push(stage);
          if (stage === 'FINAL_RESERVED') {
            const requests = await suite.admin.query(
              'SELECT request_id FROM task_execution.information_request WHERE work_order_id=(SELECT work_order_id FROM task_execution.run WHERE run_id=$1)',
              [runRef.objectId],
            );
            expect(requests.rows).toEqual([]);
            expect(item.blockerRefs).toHaveLength(1);
          }
          if (stage === 'REQUEST_OPEN') {
            expect(item.blockerRefs).toHaveLength(2);
            oldItems = (
              (await board.runAuthoritative(boardPayload(board))).data as CanonicalJsonObject
            ).items as CanonicalJsonObject[];
            const barrier = Promise.withResolvers<boolean>();
            const gate = Promise.withResolvers<boolean>();
            release = () => {
              gate.resolve(true);
            };
            const db = suite.teDb.withPlugin({
              transformQuery(args) {
                if (!reached && JSON.stringify(args.node).includes('"name":"task"'))
                  queryId = args.queryId;
                return args.node;
              },
              async transformResult(args) {
                if (queryId === args.queryId && !reached) {
                  reached = true;
                  queryId = undefined;
                  barrier.resolve(true);
                  await gate.promise;
                }
                return args.result;
              },
            });
            pendingExport = board.runExportPassWith(db);
            await Promise.race([
              barrier.promise,
              pendingExport.then(() => {
                throw new Error('Export never reached the Task SELECT');
              }),
            ]);
          }
          if (stage === 'REQUEST_RESOLVED') {
            expect(item.blockerRefs).toHaveLength(1);
            release?.();
            const exported = (await pendingExport) as { exportId: string };
            expect(reached).toBe(true);
            const manifest = (
              await suite.admin.query<{ manifest: { rows: { item: CanonicalJsonObject }[] } }>(
                'SELECT manifest FROM task_execution.task_board_export_manifest WHERE export_id=$1',
                [exported.exportId],
              )
            ).rows[0];
            expect(manifest?.manifest.rows.map((row) => row.item)).toEqual(oldItems);
            // The next real export must contain the new Request fact and its
            // exact public Task/child rows, including the conservative WO block.
            const newItems = (
              (await board.runAuthoritative(boardPayload(board))).data as CanonicalJsonObject
            ).items;
            expect(newItems).not.toEqual(oldItems);
            const next = (await board.exportPass()) as { exportId: string };
            const nextManifest = (
              await suite.admin.query<{ manifest: { rows: { item: CanonicalJsonObject }[] } }>(
                'SELECT manifest FROM task_execution.task_board_export_manifest WHERE export_id=$1',
                [next.exportId],
              )
            ).rows[0];
            expect(nextManifest?.manifest.rows.map((row) => row.item)).toEqual(newItems);
          }
          if (stage === 'RECOVERY_SUCCEEDED') {
            expect(item.blockerRefs).toEqual([]);
            expect(item.status).toBe('COMPLETION_PENDING');
            expect(item.completionEvaluationRef).toBeUndefined();
          }
          if (stage === 'COMPLETED') {
            expect(item.status).toBe('COMPLETED');
            expect(item.activeWorkOrderRefs).toEqual([]);
            expect(item.completionEvaluationRef).toBeDefined();
          }
        };
        try {
          await runScenario(
            'FORMAL_RECOVERED',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            'NORMAL',
            false,
            undefined,
            undefined,
            undefined,
            probe,
          );
        } finally {
          release?.();
          await pendingExport;
        }
        expect(seen).toEqual([
          'FINAL_RESERVED',
          'RUN_FINALIZED',
          'REQUEST_OPEN',
          'REQUEST_RESOLVED',
          'RECOVERY_SUCCEEDED',
          'COMPLETED',
        ]);
      },
    );

    suite.itIntegration(
      'BOARD-D-001 finite cancellation keeps Task/WO facts and never invents completion',
      async () => {
        const board = await boardHarness();
        const stages: string[] = [];
        let taskId = '';
        const usageProbe: NonNullable<Parameters<typeof runScenario>[10]> = async (
          stage,
          runRef,
        ) => {
          taskId = await taskForRun(runRef);
          const item = await assertBoardItem(board, taskId, false);
          stages.push(stage);
          expect(item.status).not.toBe('COMPLETED');
          expect(item.completionEvaluationRef).toBeUndefined();
          expect(item.activeWorkOrderRefs).toHaveLength(1);
        };
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
          usageProbe,
          async (stage, runRef) => {
            if (stage === 'CANCELLING') {
              stages.push(stage);
              await assertBoardItem(board, await taskForRun(runRef), false);
            }
          },
        );
        expect(stages).toEqual(['CREATED', 'STARTED', 'CANCELLING', 'CANCELLED', 'ISOLATED']);
        expect((await assertBoardItem(board, taskId, false)).status).not.toBe('COMPLETED');
      },
    );

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

    it('binds both WorkOrder creation facts (1.0 and 1.1)', async () => {
      const board = await boardHarness();
      const legacyTaskId = await suite.createExecutableTask('1.0');
      const canonicalTaskId = await suite.createExecutableTask('2.0');
      const legacyWorkOrderId = await suite.createWorkOrder({
        taskId: legacyTaskId,
        taskMajor: '1.0',
        commandVersion: '1.0',
      });
      const canonicalWorkOrderId = await suite.createWorkOrder({
        taskId: canonicalTaskId,
        taskMajor: '2.0',
        commandVersion: '1.1',
      });
      const result = await board.runAuthoritative({
        projectRef: board.projectRef,
        statuses: ['DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED'],
        page: { pageSize: 50 },
      });
      const items = (result.data as Record<string, unknown>).items as Record<string, unknown>[];
      const refs = items.flatMap(
        (item) => (item.activeWorkOrderRefs ?? []) as Record<string, unknown>[],
      );
      expect(
        refs.some(
          (ref) => ref.objectId === legacyWorkOrderId && ref.objectType === 'execution.work_order',
        ),
      ).toBe(true);
      expect(
        refs.some(
          (ref) =>
            ref.objectId === canonicalWorkOrderId &&
            ref.objectType === 'zhiju.execution.work_order',
        ),
      ).toBe(true);
    });

    it('replays the original export, generation and sequence after a crash before the confirmation', async () => {
      const board = await boardHarness();
      const projectId = boardScope(board).projectId;
      const generations = async (): Promise<number> =>
        Number(
          (
            await suite.admin.query<{ count: string }>(
              `SELECT count(*)::text AS count FROM projection.task_board_generation WHERE project_id = $1`,
              [projectId],
            )
          ).rows[0]?.count ?? '0',
        );
      const confirmationOf = async (
        exportId: string,
      ): Promise<{ manifest_hash: string; confirmed_dirty_ids: string[] } | undefined> =>
        (
          await suite.admin.query<{ manifest_hash: string; confirmed_dirty_ids: string[] }>(
            `SELECT encode(manifest_hash,'hex') AS manifest_hash, confirmed_dirty_ids
               FROM task_execution.task_board_export_confirmation WHERE export_id = $1`,
            [exportId],
          )
        ).rows[0];
      // A real owning write produces the dirty identity the export must cover.
      await suite.createExecutableTask('2.0');
      const pendingBefore = await board.dirtyCount();
      expect(pendingBefore).toBeGreaterThan(0);
      const generationsBefore = await generations();
      const crashed = await board.runExportPassCrashingBeforeConfirm();
      expect(crashed.dirtyIds.length).toBeGreaterThan(0);
      // The crash happened after the Projection commit: nothing is confirmed
      // yet, the dirty identities stay pending and no generation was added
      // beyond the published one.
      expect(await confirmationOf(crashed.exportId)).toBeUndefined();
      expect(await board.dirtyCount()).toBe(pendingBefore);
      expect(await generations()).toBe(generationsBefore + 1);
      const published = await suite.admin.query<{
        generation_id: string;
        publish_sequence: string;
      }>(
        `SELECT generation_id, publish_sequence FROM projection.task_board_generation
          WHERE project_id = $1 AND export_id = $2`,
        [projectId, crashed.exportId],
      );
      const crashedGeneration = published.rows[0];
      if (crashedGeneration === undefined) throw new Error('the crashed export was not published');
      const aliasAfterCrash = await suite.admin.query<{ generation_id: string }>(
        `SELECT generation_id FROM projection.task_board_alias WHERE project_id = $1`,
        [projectId],
      );
      expect(aliasAfterCrash.rows[0]?.generation_id).toBe(crashedGeneration.generation_id);

      // A newer owning write lands while the crashed export is still
      // unconfirmed: the recovery must confirm only the identities that
      // export covered and must not clear the newer marker.
      await suite.createExecutableTask('2.0');
      const pendingWithNewMarker = await board.dirtyCount();
      expect(pendingWithNewMarker).toBeGreaterThan(crashed.dirtyIds.length);

      // The recovery pass replays exactly the crashed export and confirms only
      // the identities that export covered.
      const recovered = (await board.exportPass()) as
        { exportId: string; publishSequence: number; replayed: boolean } | undefined;
      expect(recovered?.exportId).toBe(crashed.exportId);
      expect(String(recovered?.publishSequence)).toBe(crashedGeneration.publish_sequence);
      expect(recovered?.replayed).toBe(true);
      const confirmation = await confirmationOf(crashed.exportId);
      const storedManifest = await suite.admin.query<{ manifest_hash: string }>(
        `SELECT encode(manifest_hash,'hex') AS manifest_hash
           FROM task_execution.task_board_export_manifest WHERE export_id = $1`,
        [crashed.exportId],
      );
      expect(confirmation?.manifest_hash).toBe(storedManifest.rows[0]?.manifest_hash);
      expect([...(confirmation?.confirmed_dirty_ids ?? [])].sort()).toEqual(
        [...crashed.dirtyIds].sort(),
      );
      // The newer marker is untouched and no generation was added by the
      // recovery; the alias still points at the crashed export's generation.
      expect(await board.dirtyCount()).toBe(pendingWithNewMarker - crashed.dirtyIds.length);
      expect(await generations()).toBe(generationsBefore + 1);
      const aliasAfterRecovery = await suite.admin.query<{ generation_id: string }>(
        `SELECT generation_id FROM projection.task_board_alias WHERE project_id = $1`,
        [projectId],
      );
      expect(aliasAfterRecovery.rows[0]?.generation_id).toBe(crashedGeneration.generation_id);
      // Only a later export covers the new marker and advances the alias.
      const advanced = (await board.exportPass()) as
        { exportId: string; publishSequence: number } | undefined;
      expect(advanced?.exportId).not.toBe(crashed.exportId);
      expect(await board.dirtyCount()).toBe(0);
      const aliasAfterAdvance = await suite.admin.query<{ generation_id: string }>(
        `SELECT generation_id FROM projection.task_board_alias WHERE project_id = $1`,
        [projectId],
      );
      expect(aliasAfterAdvance.rows[0]?.generation_id).not.toBe(crashedGeneration.generation_id);
    });

    it('walks the complete old cursor after the source changes and G2 replaces the alias', async () => {
      const board = await boardHarness();
      const query = (page: CanonicalJsonObject): CanonicalJsonObject => ({
        projectRef: board.projectRef,
        statuses: ['DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED'],
        page,
      });
      /** Walk one generation to exhaustion and return its ordered row ids. */
      const walk = async (
        expectStaleOnResume: boolean,
        from?: string,
      ): Promise<{
        readonly ids: readonly string[];
        readonly exhausted: boolean;
        readonly firstCursor?: string;
      }> => {
        const ids: string[] = [];
        let cursor = from;
        let firstPage = true;
        let firstCursor: string | undefined;
        for (let page = 0; page < 50; page += 1) {
          const result = await board.runProjection(
            query(cursor === undefined ? { pageSize: 1 } : { pageSize: 1, cursor }),
          );
          const items = (result.data as Record<string, unknown>).items as Record<string, unknown>[];
          // A continuation must never come back empty while it still owes rows.
          expect(items.length).toBeGreaterThan(0);
          ids.push(
            ...items.map((item) => String((item.taskRef as Record<string, unknown>).objectId)),
          );
          const next =
            (result.data as Record<string, unknown>).nextCursor === undefined
              ? undefined
              : String((result.data as Record<string, unknown>).nextCursor);
          if (firstPage && next !== undefined) firstCursor = next;
          if (next === undefined)
            return { ids, exhausted: true, ...(firstCursor === undefined ? {} : { firstCursor }) };
          // Once the alias has moved on, every resumed page of the old cursor
          // reports at least STALE.
          if (!firstPage && expectStaleOnResume) expect(result.stalenessStatus).toBe('STALE');
          firstPage = false;
          cursor = next;
        }
        return { ids, exhausted: false, ...(firstCursor === undefined ? {} : { firstCursor }) };
      };
      // Exact ordered baseline of G1 (traversed before anything changes) plus
      // the first-page cursor that a resumed session would hold.
      const baseline = await walk(false);
      expect(baseline.exhausted).toBe(true);
      expect(baseline.ids.length).toBeGreaterThan(1);
      expect(new Set(baseline.ids).size).toBe(baseline.ids.length);
      expect(baseline.firstCursor).toBeDefined();
      // The owning source changes and G2 replaces the alias.
      const newTaskId = await suite.createExecutableTask('2.0');
      await board.exportPass();
      // The complete old-cursor traversal must reproduce the exact ordered G1
      // sequence and must exhaust rather than hit the loop cap.
      const after = await walk(true, baseline.firstCursor);
      expect(after.exhausted).toBe(true);
      // The resumed session replays the same ordered remainder of G1.
      expect(after.ids).toEqual(baseline.ids.slice(1));
      expect(after.ids).not.toContain(newTaskId);
      // The current generation (G2) is the one that owns the new row.
      const g2 = await board.runProjection(query({ pageSize: 50 }));
      const g2Ids = ((g2.data as Record<string, unknown>).items as Record<string, unknown>[]).map(
        (item) => String((item.taskRef as Record<string, unknown>).objectId),
      );
      expect(g2Ids).toContain(newTaskId);
      expect(g2Ids.length).toBeGreaterThan(after.ids.length);
    }, 30_000);

    it('does not report FRESH when the alias is replaced between the projection reads', async () => {
      const board = await boardHarness();
      // A published, clean generation is the FRESH baseline for the same query.
      await board.exportPass();
      const query = {
        projectRef: board.projectRef,
        statuses: ['DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED'],
        page: { pageSize: 50 },
      };
      const baseline = await board.runProjection(query);
      expect(baseline.stalenessStatus).toBe('FRESH');
      // A real owning write and a real export pass run while the read is in
      // flight, so the alias advances between its projection reads.
      let healthSeen = false;
      let replaced = false;
      const probeDb = new Kysely<TaskExecutionDb>({
        dialect: new PostgresDialect({ pool: board.pool }),
        plugins: [
          {
            transformQuery(args: PluginTransformQueryArgs) {
              if (!healthSeen && JSON.stringify(args.node).includes('task_board_health'))
                healthSeen = true;
              return args.node;
            },
            async transformResult(args: PluginTransformResultArgs) {
              if (healthSeen && !replaced) {
                replaced = true;
                await suite.createExecutableTask('2.0');
                await board.exportPass();
              }
              return args.result;
            },
          },
        ],
      });
      try {
        const result = await board.runWithProbe(query, 'PROJECTION_OK', probeDb);
        expect(replaced).toBe(true);
        expect(result.stalenessStatus).not.toBe('FRESH');
      } finally {
        // The handle shares the suite pool, so only the plugin is discarded.
      }
    });

    it('does not report FRESH when the owning source changes between the projection and health reads', async () => {
      const board = await boardHarness();
      await board.exportPass();
      const query = {
        projectRef: board.projectRef,
        statuses: ['DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED'],
        page: { pageSize: 50 },
      };
      expect((await board.runProjection(query)).stalenessStatus).toBe('FRESH');
      // A real owning command commits a produced identity after the read has
      // already projected its published generation, so the health read must
      // observe a pending marker the projection it returned does not cover.
      let projectionSeen = false;
      let produced = false;
      const probeDb = new Kysely<TaskExecutionDb>({
        dialect: new PostgresDialect({ pool: board.pool }),
        plugins: [
          {
            transformQuery(args: PluginTransformQueryArgs) {
              if (!projectionSeen && JSON.stringify(args.node).includes('task_board_generation'))
                projectionSeen = true;
              return args.node;
            },
            async transformResult(args: PluginTransformResultArgs) {
              if (projectionSeen && !produced) {
                produced = true;
                await suite.createExecutableTask('2.0');
              }
              return args.result;
            },
          },
        ],
      });
      const result = await board.runWithProbe(query, 'PROJECTION_OK', probeDb);
      expect(produced).toBe(true);
      expect(result.stalenessStatus).not.toBe('FRESH');
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

    it('fails closed with no data and no protected read when the Project has no configured Board Policy', async () => {
      const board = await boardHarness();
      const payload = {
        projectRef: board.projectRef,
        statuses: ['DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED'],
        page: { pageSize: 50 },
      };
      const missing = await board.runWithPolicyProbe(payload, false);
      expect(missing.outcome).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
      expect(missing.queries).toBe(0);

      const control = await board.runWithPolicyProbe(payload, true);
      expect(control.queries).toBeGreaterThan(0);
      expect(control.outcome).toMatchObject({ status: 'OK' });
    });

    for (const binding of TASK_BOARD_BINDINGS) {
      it(`IP-BOARD-D-001 independent ${binding.capabilityConfigKey} requires its Grant and config`, async () => {
        const board = await boardHarness();
        const key = binding.capabilityConfigKey;
        for (const missing of ['CONFIG', 'GRANT'] as const) {
          const denied = await board.probeMapping(key, missing);
          expect(denied.outcome).toBeInstanceOf(Error);
          expect(denied.outcome).not.toHaveProperty('data');
          expect(denied.protectedQueries).toEqual([]);
          const control = await board.probeMapping(key);
          expect(control.outcome).not.toBeInstanceOf(Error);
          expect(control.protectedQueries.length).toBeGreaterThan(0);
        }
      });
    }

    for (const consistency of ['AUTHORITATIVE', 'PROJECTION_OK']) {
      for (const change of [
        'taskBoardReadHumanV1',
        'taskBoardSourceReadV1',
        'taskBoardPolicyReadV1',
        ...(consistency === 'PROJECTION_OK' ? (['taskBoardHealthReadV1'] as const) : []),
        'EXPIRE',
        'POLICY_SUPERSEDED',
      ] as const) {
        it(`IP-BOARD-D-002 ${consistency} rechecks ${change} after the reached source SELECT`, async () => {
          const board = await boardHarness();
          await board.exportPass();
          const payload = boardPayload(board);
          const baseline =
            consistency === 'AUTHORITATIVE'
              ? await board.runAuthoritative(payload)
              : await board.runProjection(payload);
          expect(baseline.status).toBe('OK');
          const denied = await board.readAtBoundary(payload, consistency, change);
          expect(denied.reached).toBe(true);
          expect(denied.outcome).toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
          expect(denied.outcome).not.toHaveProperty('data');
          if (change !== 'EXPIRE') expect(denied.currentIdentityReads).toBeGreaterThan(0);
        });
      }
    }
    for (const change of [
      'taskBoardReadHumanV1',
      'taskBoardSourceReadV1',
      'taskBoardHealthReadV1',
      'taskBoardPolicyReadV1',
      'EXPIRE',
      'POLICY_SUPERSEDED',
    ] as const) {
      it(`IP-BOARD-D-002 rechecks ${change} on a pinned-generation continuation`, async () => {
        const board = await boardHarness();
        await board.exportPass();
        const payload = {
          projectRef: board.projectRef,
          statuses: BOARD_STATUSES,
          page: { pageSize: 1 },
        };
        const first = await board.runProjection(payload);
        if (typeof first.nextCursor !== 'string') throw new Error('missing first-page cursor');
        const denied = await board.readAtBoundary(
          { ...payload, page: { pageSize: 1, cursor: first.nextCursor } },
          'PROJECTION_OK',
          change,
        );
        expect(denied.reached).toBe(true);
        expect(denied.outcome).toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
        expect(denied.outcome).not.toHaveProperty('data');
        if (change !== 'EXPIRE') expect(denied.currentIdentityReads).toBeGreaterThan(0);
      });
    }

    it('refuses an AUTHORITATIVE read once the Service source Grant is revoked', async () => {
      const board = await boardHarness();
      // The first read succeeds under the current source authority.
      const ok = await board.runAuthoritative({
        projectRef: board.projectRef,
        statuses: ['DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED'],
        page: { pageSize: 50 },
      });
      expect(ok.status).toBe('OK');
      await board.revokeSourceAuthority();
      // The owning source mapping is no longer current: the read fails closed
      // with no data instead of serving a stale run.
      await expect(
        board.runAuthoritative({
          projectRef: board.projectRef,
          statuses: ['DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED'],
          page: { pageSize: 50 },
        }),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
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
