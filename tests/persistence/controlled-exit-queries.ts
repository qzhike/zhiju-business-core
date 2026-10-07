import {
  createTaskBoardDispatcher,
  createTaskBoardEntry,
  createUsageProvenanceEntry,
} from '@zhiju/api/composition';
import { registeredPolicyProfileReference, type Common } from '@zhiju/contracts';
import {
  createActorSnapshot,
  createTaskBoardAuthorizationPort,
  createUsageProvenanceAuthorizationPort,
  TASK_BOARD_BINDINGS,
  USAGE_PROVENANCE_BINDINGS,
  withIdentityTransaction,
  type TaskBoardCapabilityCodes,
  type UsageProvenanceCapabilityCodes,
} from '@zhiju/identity-policy';
import {
  createIntegrationRendererDatabase,
  InMemoryRenderObjectStorage,
} from '@zhiju/integration-gateway';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import { digestCanonicalPayload } from '@zhiju/task-execution';
import { expect } from 'vitest';
import {
  PROBE_ROLE,
  contentHash,
  definedValue,
  objectRef,
  record,
  type Principal,
} from './initial-context-fixtures.js';
import type { InitialContextSuite } from './initial-context-suite.js';
import { expectedBoardItem } from './controlled-exit-board-expectation.js';

/** Reuse real query composition with independently granted Human and Service identities. */
export async function createExitQueries(suite: InitialContextSuite) {
  const scope = { ...suite.fixture };
  const operator = suite.operator();
  await suite.admin.query(`GRANT projection_app TO ${PROBE_ROLE}`);
  const serviceId = newUuidV7();
  const serviceAuth = Buffer.alloc(32, 0x50);
  await withIdentityTransaction(suite.identityDb, suite.identityContext([]), (trx) =>
    suite.identityRepo.insertPrincipal(trx, {
      id: serviceId,
      principalKind: 'SERVICE',
      displayName: 'TD-07 controlled exit query service',
      createdByPrincipalId: operator.principalId,
      createdByActorSnapshotId: operator.actorSnapshotId,
    }),
  );
  async function principal(
    id: string,
    kind: 'HUMAN' | 'SERVICE',
    authHash: Buffer,
  ): Promise<Principal> {
    const actorRef = await createActorSnapshot(suite.identityDeps([scope.projectId], operator), {
      actorSnapshotId: newUuidV7(),
      principalId: id,
      declaredPrincipalKind: kind,
      authenticationContextHash: authHash,
      scopeKind: 'PROJECT',
      ...scope,
    });
    return {
      principalId: id,
      principalKind: kind,
      actorSnapshotId: actorRef.snapshotId,
      actorRef,
      authHash,
    };
  }
  const human = await principal(operator.principalId, 'HUMAN', operator.authHash);
  const service = await principal(serviceId, 'SERVICE', serviceAuth);
  const boardCodes = Object.fromEntries(
    TASK_BOARD_BINDINGS.map((b, i) => [
      b.capabilityConfigKey,
      `exit.board.c${i}.${serviceId.replaceAll('-', '')}`,
    ]),
  ) as TaskBoardCapabilityCodes;
  const usageCodes = Object.fromEntries(
    USAGE_PROVENANCE_BINDINGS.map((b, i) => [
      b.capabilityConfigKey,
      `exit.usage.c${i}.${serviceId.replaceAll('-', '')}`,
    ]),
  ) as UsageProvenanceCapabilityCodes;
  for (const binding of [...TASK_BOARD_BINDINGS, ...USAGE_PROVENANCE_BINDINGS]) {
    const codes: Record<string, string> = { ...boardCodes, ...usageCodes };
    await suite.prepareIndependentGrants([binding], async (b) => {
      await suite.grant({
        principal: b.expectedPrincipalKind === 'HUMAN' ? human : service,
        capabilityCode: definedValue(codes[b.capabilityConfigKey]),
        action: b.requiredGrantAction,
        selectorType: b.selectorType,
        targetObjectType: definedValue(b.targetObjectTypes[0]),
        targetObjectTypes: b.targetObjectTypes,
      });
    });
  }
  const projectRef = objectRef('zhiju.project.project', scope.projectId, scope) as Common.ObjectRef;
  const policyRef: Common.VersionedRef = {
    kind: 'VERSIONED',
    objectType: 'zhiju.identity.policy',
    objectId: newUuidV7(),
    versionId: newUuidV7(),
    scope,
  };
  await suite.registerPolicyVersionAs({
    key: policyRef,
    factId: newUuidV7(),
    idempotencyKey: `exit-${serviceId}`,
    effectiveFrom: new Date(Date.now() - 86_400_000),
    policySchemaRefs: [
      definedValue(
        registeredPolicyProfileReference('im06-static-v1', 'execution.task_board.policy@1.0'),
      ),
    ],
    policyDocument: {
      maxPageSize: 50,
      maxSnapshotRows: 500,
      maxSnapshotBytes: 1_048_576,
      freshnessMaxAgeSeconds: 3600,
      cursorTtlSeconds: 3600,
      refreshIntervalSeconds: 60,
      workerLeaseSeconds: 300,
    },
  });
  const now = () => new Date(suite.clock);
  const identity = { db: suite.identityDb, repo: suite.identityRepo, crypto: suite.crypto };
  const boardAuth = createTaskBoardAuthorizationPort({ capabilityCodes: boardCodes, now });
  const usageAuth = createUsageProvenanceAuthorizationPort({ capabilityCodes: usageCodes, now });
  async function mint(
    auth: typeof boardAuth | typeof usageAuth,
    key: string,
    commandType: string,
    who: Principal,
    targetRef: Common.ObjectRef,
    payload: CanonicalJsonObject,
  ) {
    // Both owning authorization ports enforce their own registered boundary.
    const result = await auth.authorize(suite.identityDeps([scope.projectId], who), key as never, {
      actorSnapshotRef: who.actorRef,
      commandType,
      commandVersion: '1.0',
      commandPayloadHash: digestCanonicalPayload(payload).hash,
      authenticationContextHash: who.authHash,
      targetRef,
    });
    if (result.outcome !== 'ALLOW') throw new Error(`${key} denied`);
    return result.authorizationDecisionRef;
  }
  const boardSource = await mint(
    boardAuth,
    'taskBoardSourceReadV1',
    'execution.task_board.source.read.v1',
    service,
    projectRef,
    { projectRef } as unknown as CanonicalJsonObject,
  );
  const boardConfig = {
    identity,
    taskExecutionDb: suite.teDb,
    capabilityCodes: boardCodes,
    now,
    cursorKey: { keyId: 1, secret: Buffer.alloc(32, 0x51) },
    boardPolicyRef: (id: string) => (id === scope.projectId ? policyRef : undefined),
  };
  const board = createTaskBoardEntry(boardConfig);
  const dispatcher = createTaskBoardDispatcher({
    ...boardConfig,
    workerOwner: `exit-${serviceId}`,
    targets: [],
  });
  const serviceSession = {
    authenticationContextHash: serviceAuth,
    resolutionActorSnapshotRef: service.actorRef,
    sourceDecisionRef: boardSource,
  };
  const queryEnvelope = (
    type: string,
    payload: CanonicalJsonObject,
    decision: Common.ContentAddressedRef,
    consistency: string,
  ) => ({
    queryId: newUuidV7(),
    queryType: type,
    queryVersion: '1.0',
    scopeRef: scope,
    requester: objectRef('zhiju.identity.principal', human.principalId, scope),
    authenticationContextRef: {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'zhiju.identity.authentication_context',
      objectId: human.actorSnapshotId,
      scope,
      contentHash: contentHash(human.authHash.toString('hex')),
    },
    authorizationDecisionRef: decision,
    consistencyRequirement: consistency,
    correlationId: newUuidV7(),
    requestedAt: now().toISOString(),
    payload,
  });
  const usage = createUsageProvenanceEntry({
    identity,
    taskExecutionDb: suite.teDb,
    integrationGatewayDb: createIntegrationRendererDatabase(suite.tePool),
    runtimeDriver: {
      invoke: () => Promise.reject(new Error('Query invoked Driver')),
      readBack: () => Promise.reject(new Error('Query read Driver')),
    },
    receiptStorage: new InMemoryRenderObjectStorage(),
    capabilityCodes: usageCodes,
    now,
  });
  async function readUsage(runRef: Common.ObjectRef) {
    const payload = { runRef } as unknown as CanonicalJsonObject;
    const humanDecision = await mint(
      usageAuth,
      'runUsageProvenanceReadHumanV1',
      'execution.get_usage_and_provenance',
      human,
      runRef,
      payload,
    );
    const source = await mint(
      usageAuth,
      'runUsageProvenanceSourceReadV1',
      'execution.run.usage_provenance.source.read.v1',
      service,
      runRef,
      payload,
    );
    return usage.getUsageAndProvenance(
      queryEnvelope('execution.get_usage_and_provenance', payload, humanDecision, 'AUTHORITATIVE'),
      {
        ...suite.sessionFor(human),
        serviceSession: { ...serviceSession, sourceDecisionRef: source },
      },
    );
  }
  async function readBoard(consistency = 'AUTHORITATIVE') {
    const payload = {
      projectRef,
      statuses: [
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
      ],
      page: { pageSize: 50 },
    } as unknown as CanonicalJsonObject;
    const decision = await mint(
      boardAuth,
      'taskBoardReadHumanV1',
      'execution.get_task_board_slice',
      human,
      projectRef,
      payload,
    );
    return board.getTaskBoardSlice(
      queryEnvelope('execution.get_task_board_slice', payload, decision, consistency),
      { ...suite.sessionFor(human), serviceSession },
    );
  }
  async function assertTaskBoard(taskId: string, blocked: boolean) {
    const expected = await expectedBoardItem(suite, taskId, blocked);
    const result = await readBoard();
    expect(record(result.data).items).toContainEqual(expected);
    return expected;
  }
  async function assertBoard(runRef: Common.ObjectRef, blocked: boolean) {
    const { task_id: taskId } = definedValue(
      (
        await suite.admin.query<{ task_id: string }>(
          'SELECT w.task_id FROM task_execution.run r JOIN task_execution.work_order w USING(work_order_id) WHERE r.run_id=$1',
          [runRef.objectId],
        )
      ).rows[0],
    );
    return assertTaskBoard(taskId, blocked);
  }
  async function snapshot() {
    // Full rows include Root versions, immutable bytes/hash, Receipts and events.
    // IP Decisions and owning Audits are measured separately, never business effects.
    const tables = (
      await suite.admin.query<{ name: string }>(
        "SELECT schemaname||'.'||tablename name FROM pg_tables WHERE schemaname=ANY($1::text[]) AND tablename <> 'audit_record' ORDER BY 1",
        [['task_execution', 'enterprise_project', 'artifact', 'integration_gateway']],
      )
    ).rows;
    const rows: Record<string, unknown> = {};
    for (const { name } of tables)
      rows[name] = (
        await suite.admin.query(
          `SELECT to_jsonb(t)::text bytes FROM ${name} t ORDER BY to_jsonb(t)::text`,
        )
      ).rows;
    return rows;
  }
  async function technicalCounts() {
    return (
      await suite.admin.query<{ decisions: number; te_audits: number; ig_audits: number }>(
        `SELECT (SELECT count(*)::int FROM identity_policy.authorization_decision) decisions, (SELECT count(*)::int FROM task_execution.audit_record) te_audits, (SELECT count(*)::int FROM integration_gateway.audit_record) ig_audits`,
      )
    ).rows;
  }
  async function assertUsage(runRef: Common.ObjectRef) {
    const run = definedValue(
      (
        await suite.admin.query<Record<string, unknown>>(
          'SELECT * FROM task_execution.run WHERE run_id=$1',
          [runRef.objectId],
        )
      ).rows[0],
    );
    const result = await readUsage(runRef);
    const provenance = record(result.provenance);
    expect(result.runRef).toEqual(runRef);
    expect(provenance).toMatchObject({
      runRef,
      runStatus: run.status,
      aggregateVersion: Number(run.aggregate_version),
      contextSnapshotRef: run.context_snapshot_ref,
      workOrderContractRef: run.work_order_contract_ref,
      capabilityGrantRef: run.capability_grant_ref,
      runtimeBinding: run.runtime_binding,
    });
    expect(result.runtimeUsageRef).toBeUndefined();
    expect(result).not.toHaveProperty('providerUsage');
    const attempt = record(provenance.attemptEvidence);
    if (run.start_attempt_ref !== null)
      expect(record(attempt.value)).toMatchObject({
        attemptRef: run.start_attempt_ref,
        runtimeAdapterIdentityRef: run.runtime_adapter_identity_ref,
        source: 'SYNTHETIC_DRIVER',
      });
    const accepted = (
      await suite.admin.query<{
        result_payload: CanonicalJsonObject;
        observation_ref: CanonicalJsonObject;
        result_id: string;
        acceptance_id: string;
        result_hash: string;
        acceptance_hash: string;
      }>(
        `SELECT a.result_payload,a.observation_ref,a.result_id,ac.acceptance_id,encode(a.result_payload_hash,'hex') result_hash,encode(ac.payload_hash,'hex') acceptance_hash FROM task_execution.agent_result a JOIN task_execution.agent_result_acceptance ac USING(run_id) WHERE a.run_id=$1`,
        [runRef.objectId],
      )
    ).rows[0];
    if (accepted) {
      const ref = (type: string, id: string, hash: string) => ({
        ...objectRef(type, id, scope),
        kind: 'CONTENT_ADDRESSED',
        contentHash: contentHash(hash),
      });
      expect(record(provenance.resultEvidence).value).toMatchObject({
        agentResultRef: ref('execution.agent_result', accepted.result_id, accepted.result_hash),
        acceptanceRecordRef: ref(
          'execution.agent_result_acceptance',
          accepted.acceptance_id,
          accepted.acceptance_hash,
        ),
        resultPayloadHash: contentHash(accepted.result_hash),
      });
      expect(record(attempt.value).observationRef).toEqual(accepted.observation_ref);
      expect(record(attempt.value).resultPayloadHash).toEqual(contentHash(accepted.result_hash));
      const declared = accepted.result_payload.agentDeclaredUsage;
      if (declared !== undefined) {
        expect(result.agentDeclaredUsage).toMatchObject({
          presence: 'PRESENT',
          value: { ...record(declared), measurementSource: 'AGENT_DECLARED' },
        });
        expect(result.authoritativeSource).toBe('AGENT_DECLARED');
      } else
        expect(result.agentDeclaredUsage).toMatchObject({
          presence: 'UNKNOWN',
          reasonCode: 'USAGE_NOT_DECLARED',
        });
    } else expect(result.agentDeclaredUsage).toMatchObject({ presence: 'UNKNOWN' });
    if (record(result.agentDeclaredUsage).presence === 'UNKNOWN')
      expect(result.agentDeclaredUsage).not.toHaveProperty('value');
    return result;
  }
  return {
    assertTaskBoard,
    assertUsage,
    assertBoard,
    readBoard,
    snapshot,
    technicalCounts,
    exportPass: () =>
      dispatcher.runExportPass({
        projectRef: projectRef as unknown as CanonicalJsonObject,
        scope,
        serviceSession: {
          authenticationContextHash: serviceAuth,
          resolutionActorSnapshotRef: service.actorRef,
          bootstrapDecisionRef: boardSource,
        },
      }),
  };
}
