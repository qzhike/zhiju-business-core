import {
  type ContextSourceSliceEntry,
  type ContextSourceSliceSession,
  createContextSourceSliceEntry,
  createCreateTaskEntry,
  createInitialContextEntry,
  createTaskCompletedDeliveryEntry,
  type CreateTaskEntry,
  createTaskReadinessEntry,
  createWorkOrderDraftEntry,
  type DeliveryCompletionSession,
  type FormalCompletionEntryConfig,
  type InitialContextCapabilityCodes,
  type InitialContextEntry,
  type RecoverySession,
  type WorkOrderDraftEntry,
} from '@zhiju/api/composition';
import {
  type Common,
  ContractRegistry,
  type EnterpriseProject,
  registeredEvaluatorProfileReference,
} from '@zhiju/contracts';
import {
  consumeDeliveryItemCompletionEvent,
  createEnterpriseProjectDatabase,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransactionContext,
  handleConfirmEnterpriseFact,
  handleCreateEnterprise,
  handleCreateProject,
  handleEnterpriseProductCreate,
  handleEnterpriseProductCreateScopeSnapshot,
  handleEnterpriseProfileCreateSnapshot,
  handleEnterpriseQmsActivateRevision,
  handleEnterpriseQmsCreateRevision,
  handleProposeEnterpriseFact,
  withEnterpriseProjectTransaction,
} from '@zhiju/enterprise-project';
import {
  type ActorSnapshotRef,
  authorizeCommand,
  createActorSnapshot,
  createIdentityPolicyDatabase,
  createTaskExecutionContextSnapshotAuthorizationPort,
  createTaskExecutionCreationAuthorizationPort,
  createTaskExecutionReadinessAuthorizationPort,
  grantCapability,
  type IdentityCommandDeps,
  type IdentityPolicyDb,
  IdentityPolicyRepository,
  type IdentityTransactionContext,
  recordPolicySnapshot,
  recordPolicyVersion,
  revokeCapability,
  taskCompletedDeliveryBindings,
  type TaskExecutionContextSnapshotCapabilityCodes,
  withIdentityTransaction,
} from '@zhiju/identity-policy';
import { canonicalize, type CanonicalJsonObject, newUuidV7 } from '@zhiju/shared-kernel';
import {
  type CommandEnvelope,
  type CommandResult,
  createTaskExecutionDatabase,
  digestCanonicalPayload,
  TASK_DRAFT_CREATION_BINDINGS,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '@zhiju/task-execution';
import { type Kysely, sql } from 'kysely';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import type { createDeliveryCompletionPlanFixture } from './delivery-completion-plan-fixture.js';
import {
  ACTIONS,
  ACTOR_SNAPSHOT_OBJECT,
  type AppRoleContext,
  type AssemblyInput,
  AUTH_CONTEXT_ID,
  AUTH_CONTEXT_OBJECT,
  AUTH_HASH,
  BUILD_COMMAND,
  BUILD_VERSION,
  BUILDER_POLICY,
  BUILDER_PROFILE,
  type BuildInput,
  CAPTURE_CAPABILITY,
  CAPTURE_POLICY,
  CAPTURE_PROFILE,
  contentHash,
  CONTEXT_SNAPSHOT_LEGACY_OBJECT,
  CONTEXT_SNAPSHOT_OBJECT,
  contextSnapshotCapabilityCodes,
  CORRELATION,
  creationCapabilityCodes,
  databaseUrl,
  DECISION_HASH,
  definedValue,
  dependencyCapabilities,
  DRAFT_SNAPSHOT_OBJECT,
  draftReadCapabilityCodes,
  failureOf,
  type Fixture,
  type LegacyImportRow,
  objectRef,
  OPERATOR,
  OPERATOR_ACTOR,
  OTHER_ACTOR,
  OTHER_AUTH_HASH,
  OTHER_PRINCIPAL,
  PAST,
  payloadOf,
  POLICY_SNAPSHOT_ID,
  policyKey,
  type Principal,
  PRINCIPAL_OBJECT,
  PROBE_PASSWORD,
  PROBE_ROLE,
  profileReference,
  PURPOSE_DOCUMENT,
  PURPOSE_FORM,
  PURPOSE_REVIEW,
  READ_QUERY,
  READ_VERSION,
  record,
  RECORD_CAPABILITY,
  REQUEST_DECISION,
  resultCode,
  rewriteFixtureScopes,
  SLICE_KINDS,
  SLICE_OBJECT,
  TASK_V1,
  TASK_V2,
  testCrypto,
  V1_TASK_FIXTURE,
  V2_TASK_FIXTURE,
  WORK_ORDER_CONTRACT_FIXTURE,
  WORK_ORDER_V1,
  WORK_ORDER_V11,
} from './initial-context-fixtures.js';
export function createInitialContextSuite(
  options: {
    databaseUrl?: string;
    registerHooks?: boolean;
    diagnosticLabel?: string;
    observeOperation?: (operation: Promise<unknown>) => void;
  } = {},
) {
  const activeDatabaseUrl = options.databaseUrl ?? databaseUrl;

  const crypto = testCrypto();

  const registry = new ContractRegistry();

  let admin: pg.Client;

  let probeUrl: string;

  let tePool: pg.Pool;

  let ipPool: pg.Pool;

  let epPool: pg.Pool;

  let teDb: Kysely<TaskExecutionDb>;

  let identityDb: Kysely<IdentityPolicyDb>;

  let enterpriseProjectDb: Kysely<EnterpriseProjectDb>;

  let identityRepo: IdentityPolicyRepository;

  let fixture: Fixture;

  let clock: number;

  let grantPolicyHash: Buffer;

  let operatorActorRef: ActorSnapshotRef;

  let otherActorRef: ActorSnapshotRef;

  let initialContextEntry: InitialContextEntry;

  let workOrderEntry: WorkOrderDraftEntry;

  let taskEntry: CreateTaskEntry;

  let sliceEntry: ContextSourceSliceEntry;

  let sliceSession: ContextSourceSliceSession;

  let grantCtxBuild: string;

  let grantCtxRead: string;

  let grantCtxDraftRead: string;

  let grantResolve: string;

  let grantSliceRead: string;

  let sliceARef: Common.ContentAddressedRef;

  let sliceBRef: Common.ContentAddressedRef;

  let sliceCRef: Common.ContentAddressedRef;

  let sliceTTLRef: Common.ContentAddressedRef;

  let sliceRevokedRef: Common.ContentAddressedRef;

  let sliceMixRef: Common.ContentAddressedRef;

  let factA1: { objectId: string; versionId: string };

  let factA2: { objectId: string; versionId: string };

  let goldenWorkOrderId: string;

  let goldenDraftRef: Common.ContentAddressedRef;

  function progress(event: string, detail: string): void {
    process.stdout.write(
      `[initial-context] ${event}: ${detail}${options.diagnosticLabel ? `; environment=${options.diagnosticLabel}` : ''}\n`,
    );
  }

  const cleanupResources: (pg.Pool | pg.Client)[] = [];

  let currentPhase = 'idle';

  let phaseStarted = performance.now();

  function phaseEnd(): void {
    if (currentPhase === 'idle') return;
    progress(
      'phase end',
      `${currentPhase}; elapsedMs=${Math.round(performance.now() - phaseStarted)}`,
    );
    currentPhase = 'idle';
  }

  function phase(name: string): void {
    phaseEnd();
    currentPhase = name;
    phaseStarted = performance.now();
    progress('phase start', name);
  }

  async function databaseWaits(): Promise<void> {
    // No SQL text, business payloads, credentials or connection URLs.
    const result = await admin.query(
      `SELECT pid, state, wait_event_type, wait_event, pg_blocking_pids(pid) AS blockers,
              extract(epoch FROM clock_timestamp()-xact_start)::int AS transaction_seconds
       FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()`,
    );
    progress('database activity', JSON.stringify(result.rows));
  }

  async function waitForDeadline(milliseconds: number, label: string): Promise<void> {
    const started = performance.now();
    progress('wait start', `${label}; requestedMs=${milliseconds}`);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
    } finally {
      progress('wait end', `${label}; elapsedMs=${Math.round(performance.now() - started)}`);
    }
  }

  const INTEGRATION_TEST_TIMEOUT = 60_000;

  function itIntegration(
    name: string,
    run: () => Promise<void>,
    timeout = INTEGRATION_TEST_TIMEOUT,
  ): void {
    it(name, { timeout }, () => runIntegrationCase(name, run));
  }

  async function runIntegrationCase(name: string, run: () => Promise<void>): Promise<void> {
    const started = performance.now();
    progress('test start', name);
    phase('test body');
    const heartbeat = setInterval(() => {
      progress('heartbeat', `${name}; phase=${currentPhase}; pending=${pendingOperations.size}`);
      void databaseWaits().catch(() => {
        // Diagnostics are best effort; preserve the original failure.
      });
    }, 30_000);
    try {
      await run();
    } catch (error) {
      await databaseWaits().catch(() => {
        // Diagnostics are best effort; preserve the original failure.
      });
      throw error;
    } finally {
      clearInterval(heartbeat);
      phaseEnd();
      progress('test body end', `${name}; elapsedMs=${Math.round(performance.now() - started)}`);
    }
  }

  const pendingOperations = new Set<Promise<unknown>>();

  function track<T>(operation: Promise<T>): Promise<T> {
    pendingOperations.add(operation);
    options.observeOperation?.(operation);
    void operation.then(
      () => pendingOperations.delete(operation),
      () => pendingOperations.delete(operation),
    );
    return operation;
  }

  const grantCapabilityTracked: typeof grantCapability = (...args) =>
    track(grantCapability(...args));

  const revokeCapabilityTracked: typeof revokeCapability = (...args) =>
    track(revokeCapability(...args));

  const recordPolicySnapshotTracked: typeof recordPolicySnapshot = (...args) =>
    track(recordPolicySnapshot(...args));

  const recordPolicyVersionTracked: typeof recordPolicyVersion = (...args) =>
    track(recordPolicyVersion(...args));

  const authorizeCommandTracked: typeof authorizeCommand = (...args) =>
    track(authorizeCommand(...args));

  async function drain() {
    phase('pending operation drain');
    // Drain until two consecutive quiescent passes: an abandoned helper can
    // sit between two tracked drivers with its continuation not yet queued.
    let quiescentPasses = 0;
    while (quiescentPasses < 2) {
      await Promise.allSettled([...pendingOperations]);
      await new Promise((resolve) => setImmediate(resolve));
      quiescentPasses = pendingOperations.size === 0 ? quiescentPasses + 1 : 0;
    }
    phaseEnd();
  }

  function observeEntry<T extends object>(entry: T): T {
    return new Proxy(entry, {
      get(target, key, receiver) {
        const value: unknown = Reflect.get(target, key, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          const started = performance.now();
          progress('command start', String(key));
          return track(
            Promise.resolve().then(() => Reflect.apply(value, target, args) as unknown),
          ).finally(() => {
            progress(
              'command end',
              `${String(key)}; elapsedMs=${Math.round(performance.now() - started)}`,
            );
          });
        };
      },
    });
  }

  function operator(): Principal {
    return {
      principalId: OPERATOR,
      principalKind: 'HUMAN',
      actorSnapshotId: OPERATOR_ACTOR,
      actorRef: operatorActorRef,
      authHash: AUTH_HASH,
    };
  }

  function other(): Principal {
    return {
      principalId: OTHER_PRINCIPAL,
      principalKind: 'HUMAN',
      actorSnapshotId: OTHER_ACTOR,
      actorRef: otherActorRef,
      authHash: OTHER_AUTH_HASH,
    };
  }

  const scope = (): Record<string, string> => ({
    enterpriseId: fixture.enterpriseId,
    projectId: fixture.projectId,
  });

  function identityContext(
    allowedProjectIds: readonly string[],
    principal: Principal = operator(),
    overrides: Partial<IdentityTransactionContext> = {},
  ): IdentityTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: principal.principalId,
      actorSnapshotId: principal.actorSnapshotId,
      authorizationDecisionId: REQUEST_DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      enterpriseId: fixture.enterpriseId,
      allowedProjectIds,
      correlationId: CORRELATION,
      ...overrides,
    };
  }

  function identityDeps(
    allowedProjectIds: readonly string[],
    principal: Principal = operator(),
    overrides: Partial<IdentityTransactionContext> = {},
  ): IdentityCommandDeps {
    return {
      db: identityDb,
      repo: identityRepo,
      crypto,
      context: identityContext(allowedProjectIds, principal, overrides),
    };
  }

  function runnerContext(principal: Principal = operator()): TaskExecutionTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: principal.principalId,
      principalKind: principal.principalKind,
      actorSnapshotId: principal.actorRef.snapshotId,
      authorizationDecisionId: REQUEST_DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      policySnapshotId: POLICY_SNAPSHOT_ID,
      enterpriseId: fixture.enterpriseId,
      allowedProjectIds: [fixture.projectId],
      correlationId: CORRELATION,
    };
  }

  function entryFor(
    overrides: {
      now?: () => Date;
      capabilityCodes?: InitialContextCapabilityCodes;
      capabilities?: { resolvePolicy: string; readContextSourceSlice: string };
      taskExecutionDb?: Kysely<TaskExecutionDb>;
      enterpriseProjectDb?: Kysely<EnterpriseProjectDb>;
      identityDb?: Kysely<IdentityPolicyDb>;
    } = {},
  ): InitialContextEntry {
    return createInitialContextEntry({
      taskExecutionDb: overrides.taskExecutionDb ?? teDb,
      enterpriseProjectDb: overrides.enterpriseProjectDb ?? enterpriseProjectDb,
      identity: {
        db: overrides.identityDb ?? identityDb,
        repo: identityRepo,
        crypto,
      },
      capabilityCodes: overrides.capabilityCodes ?? contextSnapshotCapabilityCodes,
      capabilities: overrides.capabilities ?? dependencyCapabilities,
      now: overrides.now ?? ((): Date => new Date(clock)),
    });
  }

  function sessionFor(principal: Principal = operator()): RecoverySession {
    return {
      serviceEntryAt: new Date(clock),
      authenticationContextHash: principal.authHash,
      resolutionActorSnapshotRef: principal.actorRef,
    };
  }

  async function grant(input: {
    principal?: Principal;
    capabilityCode: string;
    selectorType: 'CREATE_TARGET_TYPE' | 'TARGET_TYPE';
    targetObjectType: string;
    targetObjectTypes?: readonly string[];
    action: string;
    actions?: readonly string[];
    validTo?: Date;
    grantPolicySnapshot?: { id: string; hash: Buffer };
  }): Promise<string> {
    const principal = input.principal ?? operator();
    const grantId = newUuidV7();
    const result = await grantCapabilityTracked(identityDeps([fixture.projectId], principal), {
      grantId,
      principalId: principal.principalId,
      capabilityCode: input.capabilityCode,
      scope: {
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      },
      resourceSelectors: (input.targetObjectTypes ?? [input.targetObjectType]).map(
        (objectType) => ({ selectorType: input.selectorType, objectType }),
      ),
      actions: [...(input.actions ?? [input.action])],
      validFrom: PAST,
      ...(input.validTo === undefined ? {} : { validTo: input.validTo }),
      grantPolicySnapshotId: input.grantPolicySnapshot?.id ?? POLICY_SNAPSHOT_ID,
      grantPolicySnapshotHash: input.grantPolicySnapshot?.hash ?? grantPolicyHash,
      justification: 'IM-06 #216 initial Context fixture',
      idempotencyKey: `wi216:grant:${grantId}`,
    });
    expect(result.status, JSON.stringify(result)).toBe('COMMITTED');
    return grantId;
  }

  async function prepareIndependentGrants<T>(
    entries: readonly T[],
    prepare: (entry: T) => Promise<void>,
  ): Promise<void> {
    // Distinct grant targets/codes have independent owning transactions. Bound
    // preparation concurrency and await every grant before any Run deadline.
    for (let index = 0; index < entries.length; index += 4)
      await Promise.all(entries.slice(index, index + 4).map(prepare));
  }

  async function grantGeneric(
    capabilityCode: string,
    principal: Principal = operator(),
  ): Promise<string> {
    const grantId = newUuidV7();
    const result = await grantCapabilityTracked(identityDeps([fixture.projectId], principal), {
      grantId,
      principalId: principal.principalId,
      capabilityCode,
      scope: {
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      },
      resourceSelectors: [],
      actions: [capabilityCode],
      validFrom: PAST,
      grantPolicySnapshotId: POLICY_SNAPSHOT_ID,
      grantPolicySnapshotHash: grantPolicyHash,
      justification: 'IM-06 #216 dependency read fixture',
      idempotencyKey: `wi216:grant:${grantId}`,
    });
    expect(result.status).toBe('COMMITTED');
    return grantId;
  }

  function grantPolicySnapshotReference(): Common.SnapshotRef {
    return {
      kind: 'SNAPSHOT',
      objectType: 'identity.policy_snapshot',
      objectId: POLICY_SNAPSHOT_ID,
      snapshotId: POLICY_SNAPSHOT_ID,
      scope: {},
      contentHash: contentHash(grantPolicyHash.toString('hex')),
    };
  }

  async function registerPolicyVersionAs(input: {
    key: Common.VersionedRef;
    factId: string;
    idempotencyKey: string;
    effectiveFrom: Date;
    policySchemaRefs: readonly Common.TypedReference[];
    policyDocument: CanonicalJsonObject;
    supersedesRef?: Common.VersionedRef;
  }): Promise<void> {
    const keyScope = input.key.scope as unknown as { enterpriseId: string; projectId?: string };
    const projectScoped = keyScope.projectId !== undefined;
    const scopeValue = input.key.scope as unknown as CanonicalJsonObject;
    const payload: CanonicalJsonObject = {
      policyRef: input.key as unknown as CanonicalJsonObject,
      policySetVersion: `wi216-set-${input.idempotencyKey}`,
      policySchemaRefs: input.policySchemaRefs as unknown as CanonicalJsonObject,
      policyDocument: input.policyDocument,
      effectiveFrom: input.effectiveFrom.toISOString(),
      ...(input.supersedesRef === undefined
        ? {}
        : { supersedesRef: input.supersedesRef as unknown as CanonicalJsonObject }),
    };
    const decision = await authorizeCommandTracked(identityDeps([fixture.projectId]), {
      actorSnapshotRef: operatorActorRef,
      intent: {
        commandType: 'identity.record_policy_version',
        commandVersion: '1.0',
        scopeKind: projectScoped ? 'PROJECT' : 'ENTERPRISE',
        enterpriseId: fixture.enterpriseId,
        ...(projectScoped ? { projectId: fixture.projectId } : {}),
        purpose: 'identity.policy.record_policy_version',
        requestedCapability: RECORD_CAPABILITY,
        commandPayloadHash: digestCanonicalPayload(payload).hash,
        requestedAt: new Date(),
        highRiskAction: false,
      },
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: grantPolicySnapshotReference(),
      ttlSeconds: 1800,
    });
    expect(decision.outcome, JSON.stringify(decision)).toBe('ALLOW');
    const result = await recordPolicyVersionTracked(
      identityDeps(projectScoped ? [fixture.projectId] : [], operator(), {
        authorizationDecisionId: decision.authorizationDecisionRef.objectId,
        authorizationDecisionHash: Buffer.from(
          decision.authorizationDecisionRef.contentHash.digest,
          'hex',
        ),
        authorizationDecisionExpiresAt: new Date(decision.expiresAt),
      }),
      {
        envelope: {
          commandId: newUuidV7(),
          commandType: 'identity.record_policy_version',
          commandVersion: '1.0',
          scopeRef: scopeValue,
          targetRef: {
            kind: 'OBJECT',
            objectType: 'zhiju.identity.policy_version',
            objectId: input.factId,
            scope: scopeValue,
          },
          actor: {
            kind: 'OBJECT',
            objectType: PRINCIPAL_OBJECT,
            objectId: OPERATOR,
            scope: scopeValue,
          },
          authorizationDecisionRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'identity.authorization_decision',
            objectId: decision.authorizationDecisionRef.objectId,
            scope: scopeValue,
            contentHash: decision.authorizationDecisionRef
              .contentHash as unknown as CanonicalJsonObject,
          },
          idempotencyKey: input.idempotencyKey,
          correlationId: CORRELATION,
          requestedAt: new Date().toISOString(),
          payload,
          integrity: {
            canonicalizationVersion: '1',
            payloadHash: {
              algorithm: 'SHA-256',
              digest: digestCanonicalPayload(payload).hash.toString('hex'),
              canonicalizationVersion: '1',
            },
          },
        },
      },
    );
    expect(result).toMatchObject({ status: 'COMMITTED' });
  }

  function seedContext(
    enterpriseId: string,
    allowedProjectIds: readonly string[],
  ): EnterpriseProjectTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: OPERATOR,
      principalKind: 'HUMAN',
      actorSnapshotId: OPERATOR_ACTOR,
      authorizationDecisionId: REQUEST_DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      policySnapshotId: POLICY_SNAPSHOT_ID,
      enterpriseId,
      allowedProjectIds,
      correlationId: CORRELATION,
    };
  }

  function seedEnvelope<TPayload>(
    context: EnterpriseProjectTransactionContext,
    commandType: string,
    idempotencyKey: string,
    payload: TPayload,
    overrides: Partial<CommandEnvelope> = {},
  ): CommandEnvelope & { payload: TPayload } {
    return {
      commandId: newUuidV7(),
      commandType,
      commandVersion: '1.0',
      idempotencyScope: 'enterprise_project:wi216-seed',
      idempotencyKey,
      requestPayload: { commandType, payload } as unknown as CanonicalJsonObject,
      enterpriseId: context.enterpriseId,
      targetType: 'Unknown',
      targetId: newUuidV7(),
      correlationId: context.correlationId,
      principalId: context.principalId,
      principalKind: context.principalKind,
      actorSnapshotId: context.actorSnapshotId,
      authorizationDecisionId: context.authorizationDecisionId,
      policySnapshotId: context.policySnapshotId,
      ...overrides,
      payload,
    };
  }

  function committedPayload(result: CommandResult): CanonicalJsonObject {
    if (result.status !== 'COMMITTED') {
      throw new Error(`expected COMMITTED, got ${result.status} ${result.errorCode ?? ''}`);
    }
    return result.resultPayload;
  }

  function epObjectRef<TObjectType extends string>(
    objectType: TObjectType,
    objectId: string,
    enterpriseId: string,
  ) {
    return {
      kind: 'OBJECT',
      objectType,
      objectId,
      scope: { enterpriseId },
    } as Common.ObjectRef & { objectType: TObjectType };
  }

  function epVersionedRef<TObjectType extends string>(
    objectType: TObjectType,
    objectId: string,
    versionId: string,
    enterpriseId: string,
  ) {
    return {
      kind: 'VERSIONED',
      objectType,
      objectId,
      versionId,
      scope: { enterpriseId },
    } as Common.VersionedRef & { objectType: TObjectType };
  }

  function epSnapshotRef<TObjectType extends string>(
    objectType: TObjectType,
    snapshotId: string,
    digest: string,
    enterpriseId: string,
  ) {
    return {
      kind: 'SNAPSHOT',
      objectType,
      objectId: snapshotId,
      snapshotId,
      scope: { enterpriseId },
      contentHash: { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' },
    } as Common.SnapshotRef & { objectType: TObjectType };
  }

  async function seedEnterpriseProject(): Promise<Fixture> {
    const enterpriseId = newUuidV7();
    const context = seedContext(enterpriseId, []);
    const enterprise = await handleCreateEnterprise(enterpriseProjectDb, context, {
      ...seedEnvelope(context, 'project.create_enterprise', 'wi216-enterprise', {
        displayCode: 'WI216',
        displayName: 'WI-216 initial Context fixture',
        initialStatus: 'ACTIVE' as const,
      }),
      enterpriseId,
      targetType: 'Enterprise',
      targetId: enterpriseId,
    });
    expect(enterprise.status).toBe('COMMITTED');

    const product = committedPayload(
      await handleEnterpriseProductCreate(
        enterpriseProjectDb,
        context,
        seedEnvelope(context, 'enterprise_product.create', 'wi216-product', {
          enterpriseRef: epObjectRef('Enterprise', enterpriseId, enterpriseId),
          displayCode: 'WI216-PRODUCT',
          initialVersion: {
            productType: 'manufactured.widget',
            displayName: 'WI216 Widget',
            intendedUse: 'initial Context fixture',
            productScope: { family: 'widget', markets: ['CN'] },
            sourceRefs: [epObjectRef('SourceMaterial', newUuidV7(), enterpriseId)],
          },
        }),
      ),
    ) as unknown as {
      productRef: { objectId: string };
      productVersionRef: { versionId: string };
    };
    const productScope = committedPayload(
      await handleEnterpriseProductCreateScopeSnapshot(
        enterpriseProjectDb,
        context,
        seedEnvelope(context, 'enterprise_product.create_scope_snapshot', 'wi216-scope', {
          productRef: { objectType: 'Product' as const, objectId: product.productRef.objectId },
          productVersionRefs: [
            {
              objectType: 'ProductVersion',
              objectId: product.productRef.objectId,
              versionId: product.productVersionRef.versionId,
            },
          ],
          purpose: 'WI216 product scope fixture',
        }),
      ),
    ) as unknown as { productScopeSnapshotRef: { objectId: string }; payloadHash: string };

    const qms = committedPayload(
      await handleEnterpriseQmsCreateRevision(
        enterpriseProjectDb,
        context,
        seedEnvelope(context, 'enterprise_qms.create_revision', 'wi216-qms', {
          qmsConfigurationRef: epObjectRef('QMSConfiguration', newUuidV7(), enterpriseId),
          applicabilityDecisions: [{ requirementRef: 'req-1', outcome: 'APPLICABLE' }],
          managementChoices: [{ choiceKey: 'review-cycle', selectedOption: 'quarterly' }],
          professionalDecisions: [{ decisionType: 'risk-method', outcome: 'apply' }],
          sourceRefs: [epObjectRef('SourceMaterial', newUuidV7(), enterpriseId)],
        }),
      ),
    ) as unknown as { qmsConfigurationRevisionRef: { objectId: string; versionId: string } };
    await handleEnterpriseQmsActivateRevision(
      enterpriseProjectDb,
      context,
      seedEnvelope(
        context,
        'enterprise_qms.activate_revision',
        'wi216-qms-activate',
        {
          qmsConfigurationRef: epObjectRef(
            'QMSConfiguration',
            qms.qmsConfigurationRevisionRef.objectId,
            enterpriseId,
          ),
          qmsConfigurationRevisionRef: epVersionedRef(
            'QMSConfigurationRevision',
            qms.qmsConfigurationRevisionRef.objectId,
            qms.qmsConfigurationRevisionRef.versionId,
            enterpriseId,
          ),
          activationMode: 'ACTIVATE' as const,
          expectedAggregateVersion: '1',
          humanDecisionRef: epObjectRef('BusinessDecision', newUuidV7(), enterpriseId),
        },
        { expectedAggregateVersion: '1' },
      ),
    );

    const profile = committedPayload(
      await handleEnterpriseProfileCreateSnapshot(
        enterpriseProjectDb,
        context,
        seedEnvelope(context, 'enterprise_profile.create_snapshot', 'wi216-profile', {
          enterpriseRef: epObjectRef('Enterprise', enterpriseId, enterpriseId),
          enterpriseFactVersionRefs: [],
          productVersionRefs: [
            {
              objectType: 'ProductVersion',
              objectId: product.productRef.objectId,
              versionId: product.productVersionRef.versionId,
            },
          ],
          qmsConfigurationRef: epObjectRef(
            'QMSConfiguration',
            qms.qmsConfigurationRevisionRef.objectId,
            enterpriseId,
          ),
          qmsConfigurationRevisionRef: epVersionedRef(
            'QMSConfigurationRevision',
            qms.qmsConfigurationRevisionRef.objectId,
            qms.qmsConfigurationRevisionRef.versionId,
            enterpriseId,
          ),
          purpose: 'WI216 profile fixture',
        }),
      ),
    ) as unknown as { enterpriseProfileSnapshotRef: { objectId: string }; payloadHash: string };

    const project = committedPayload(
      await handleCreateProject(
        enterpriseProjectDb,
        context,
        seedEnvelope(context, 'project.create_project', 'wi216-project', {
          enterpriseRef: epObjectRef('Enterprise', enterpriseId, enterpriseId),
          displayCode: 'WI216-PROJECT',
          title: 'WI216 project',
          objective: 'initial Context persistence acceptance fixture',
          startSnapshot: {
            enterpriseProfileSnapshotRef: epSnapshotRef(
              'EnterpriseProfileSnapshot',
              profile.enterpriseProfileSnapshotRef.objectId,
              profile.payloadHash,
              enterpriseId,
            ),
            qmsConfigurationRef: epVersionedRef(
              'QMSConfiguration',
              qms.qmsConfigurationRevisionRef.objectId,
              qms.qmsConfigurationRevisionRef.versionId,
              enterpriseId,
            ),
            productScopeSnapshotRef: epSnapshotRef(
              'ProductScopeSnapshot',
              productScope.productScopeSnapshotRef.objectId,
              productScope.payloadHash,
              enterpriseId,
            ),
          },
          memberPolicyRef: epVersionedRef('Policy', newUuidV7(), newUuidV7(), enterpriseId),
        }),
      ),
    ) as unknown as { projectRef: { objectId: string } };
    return { enterpriseId, projectId: project.projectRef.objectId };
  }

  async function proposeAndConfirmFact(
    tag: string,
    riskLevel: 'LOW' | 'MEDIUM',
  ): Promise<{ objectId: string; versionId: string }> {
    const factContext: EnterpriseProjectTransactionContext = {
      ...seedContext(fixture.enterpriseId, []),
      authorizationPurposes: ['project.context_source.capture', 'project.context_source.read'],
    };
    const proposed = await track(
      handleProposeEnterpriseFact(
        enterpriseProjectDb,
        factContext,
        seedEnvelope(factContext, 'project.propose_enterprise_fact', `wi216:fact:${tag}:propose`, {
          enterpriseRef: epObjectRef('Enterprise', fixture.enterpriseId, fixture.enterpriseId),
          proposal: {
            factType: `wi216.fact.${tag}`,
            value: { presence: 'PRESENT', value: { tag }, evidenceRefs: [] },
            sourceRefs: [epObjectRef('SourceMaterial', newUuidV7(), fixture.enterpriseId)],
            riskLevel,
            proposalReason: {
              reasonCode: 'WI216_FIXTURE',
              summary: `WI-216 ${tag} fixture`,
              evidenceRefs: [],
            },
          },
        }),
      ),
    );
    expect(proposed.status).toBe('COMMITTED');
    const proposedRef = record(committedPayload(proposed).enterpriseFactRef) as unknown as {
      objectId: string;
      versionId: string;
    };
    const confirmed = await track(
      handleConfirmEnterpriseFact(
        enterpriseProjectDb,
        factContext,
        seedEnvelope(factContext, 'project.confirm_enterprise_fact', `wi216:fact:${tag}:confirm`, {
          proposalVersionRef: epVersionedRef(
            'EnterpriseFact',
            proposedRef.objectId,
            proposedRef.versionId,
            fixture.enterpriseId,
          ),
          evidenceRefs: [
            {
              evidence: {
                kind: 'CONTENT_ADDRESSED' as const,
                objectType: 'SourceMaterial',
                objectId: newUuidV7(),
                scope: { enterpriseId: fixture.enterpriseId },
                contentHash: contentHash('a'.repeat(64)),
              },
              relation: 'SUPPORTS' as const,
            },
          ],
          confirmedValue: { presence: 'PRESENT', value: { tag }, evidenceRefs: [] },
          justification: {
            reasonCode: 'WI216_FIXTURE',
            summary: `WI-216 ${tag} confirmation`,
            evidenceRefs: [],
          },
        }),
      ),
    );
    expect(confirmed.status).toBe('COMMITTED');
    const confirmedRef = record(committedPayload(confirmed).enterpriseFactRef) as unknown as {
      objectId: string;
      versionId: string;
    };
    return { objectId: confirmedRef.objectId, versionId: confirmedRef.versionId };
  }

  async function captureSlice(input: {
    principal?: Principal;
    purpose: string;
    capturePolicyRef: Common.VersionedRef;
    idempotencyKey: string;
    requestedKinds?: readonly string[];
  }): Promise<Common.ContentAddressedRef> {
    const principal = input.principal ?? operator();
    const payload = {
      projectRef: {
        kind: 'OBJECT',
        objectType: 'zhiju.project.project',
        objectId: fixture.projectId,
        scope: scope(),
      },
      purpose: input.purpose,
      audience: { principalKind: principal.principalKind, principalId: principal.principalId },
      requestedKinds: [...(input.requestedKinds ?? SLICE_KINDS)],
      capturePolicyRef: input.capturePolicyRef,
    } as unknown as EnterpriseProject.ProjectCaptureContextSourceSlicePayload;
    const decision = await authorizeCommandTracked(identityDeps([fixture.projectId], principal), {
      actorSnapshotRef: principal.actorRef,
      intent: {
        commandType: 'project.capture_context_source_slice',
        commandVersion: '1.0',
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
        purpose: 'project.context_source.capture',
        requestedCapability: CAPTURE_CAPABILITY,
        commandPayloadHash: digestCanonicalPayload(payload as unknown as CanonicalJsonObject).hash,
        requestedAt: new Date(),
        highRiskAction: false,
      },
      authenticationContextHash: principal.authHash,
      policySnapshotRef: grantPolicySnapshotReference(),
      ttlSeconds: 900,
    });
    expect(decision.outcome, JSON.stringify(decision)).toBe('ALLOW');
    const envelope = {
      commandId: newUuidV7(),
      commandType: 'project.capture_context_source_slice',
      commandVersion: '1.0',
      scopeRef: scope(),
      targetRef: {
        kind: 'OBJECT',
        objectType: SLICE_OBJECT,
        objectId: newUuidV7(),
        scope: scope(),
      },
      actor: principal.actorRef,
      authorizationDecisionRef: decision.authorizationDecisionRef,
      idempotencyKey: input.idempotencyKey,
      correlationId: CORRELATION,
      requestedAt: new Date().toISOString(),
      payload,
      integrity: {
        canonicalizationVersion: '1',
        payloadHash: contentHash(
          digestCanonicalPayload(payload as unknown as CanonicalJsonObject).hash.toString('hex'),
        ),
      },
    } as unknown as CanonicalJsonObject;
    const result = await track(
      sliceEntry.capture(
        envelope,
        input.principal === undefined
          ? sliceSession
          : {
              authenticationContextHash: principal.authHash,
              policyResolutionActorSnapshotRef: principal.actorRef,
            },
      ),
    );
    const resultPayload =
      result.status === 'DUPLICATE' ? result.resultPayload : committedPayload(result);
    if (resultPayload === null) throw new Error('expected a stored slice result payload');
    return record(resultPayload).sourceSliceRef as Common.ContentAddressedRef;
  }

  async function prepareSuite(deliveryOnly = false) {
    phase('suite business preparation');
    admin = new pg.Client({ connectionString: activeDatabaseUrl });
    cleanupResources.push(admin);
    await admin.connect();
    await admin.query(
      `DO $do$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PROBE_ROLE}') THEN
           CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${PROBE_PASSWORD}'
             NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
         END IF;
       END $do$`,
    );
    await admin.query(
      `GRANT platform_context_establisher, task_execution_app, enterprise_project_app, identity_policy_app, integration_gateway_app, artifact_app, quality_governance_app, task_execution_dispatcher, enterprise_project_platform_reference_writer TO ${PROBE_ROLE}`,
    );
    const url = new URL(activeDatabaseUrl ?? '');
    url.username = PROBE_ROLE;
    url.password = PROBE_PASSWORD;
    const probeConnectionUrl = url.toString();
    probeUrl = probeConnectionUrl;
    tePool = new pg.Pool({ connectionString: probeConnectionUrl, max: 6 });
    cleanupResources.push(tePool);
    ipPool = new pg.Pool({ connectionString: probeConnectionUrl, max: 6 });
    cleanupResources.push(ipPool);
    epPool = new pg.Pool({ connectionString: probeConnectionUrl, max: 6 });
    cleanupResources.push(epPool);
    teDb = createTaskExecutionDatabase(tePool);
    identityDb = createIdentityPolicyDatabase(ipPool);
    enterpriseProjectDb = createEnterpriseProjectDatabase(epPool);
    identityRepo = new IdentityPolicyRepository(crypto);
    clock = Date.now();
    fixture = await seedEnterpriseProject();

    // Identity facts: principals, the grant Policy Snapshot and the actor
    // snapshots precede every grant and Decision.
    for (const [id, principalKind, displayName] of [
      [OPERATOR, 'HUMAN', 'WI-216 operator'],
      [OTHER_PRINCIPAL, 'HUMAN', 'WI-216 second human'],
    ] as const) {
      await withIdentityTransaction(identityDb, identityContext([]), (trx) =>
        identityRepo.insertPrincipal(trx, {
          id,
          principalKind,
          displayName,
          createdByPrincipalId: OPERATOR,
          createdByActorSnapshotId: OPERATOR_ACTOR,
        }),
      );
    }
    const policySnapshot = await recordPolicySnapshotTracked(identityDeps([]), {
      policySnapshotId: POLICY_SNAPSHOT_ID,
      policySetVersion: `wi216-grant-policy-set-${newUuidV7()}`,
      policySchemaRefs: ['identity.PolicySnapshot@1.0'],
      effectiveFrom: PAST,
      policyDocument: { rules: ['initial-context-authorization'], version: 1 },
      idempotencyKey: `wi216:policy:${newUuidV7()}`,
    });
    expect(policySnapshot.status).toBe('COMMITTED');
    const policyRow = (
      await admin.query<{ payload_hash: Buffer }>(
        'SELECT payload_hash FROM identity_policy.policy_snapshot WHERE policy_snapshot_id = $1',
        [POLICY_SNAPSHOT_ID],
      )
    ).rows.at(0);
    if (policyRow === undefined) throw new Error('grant Policy Snapshot row missing');
    grantPolicyHash = policyRow.payload_hash;

    operatorActorRef = await createActorSnapshot(identityDeps([fixture.projectId]), {
      actorSnapshotId: OPERATOR_ACTOR,
      principalId: OPERATOR,
      declaredPrincipalKind: 'HUMAN',
      authenticationContextHash: AUTH_HASH,
      scopeKind: 'PROJECT',
      enterpriseId: fixture.enterpriseId,
      projectId: fixture.projectId,
    });
    otherActorRef = await createActorSnapshot(identityDeps([fixture.projectId], other()), {
      actorSnapshotId: OTHER_ACTOR,
      principalId: OTHER_PRINCIPAL,
      declaredPrincipalKind: 'HUMAN',
      authenticationContextHash: OTHER_AUTH_HASH,
      scopeKind: 'PROJECT',
      enterpriseId: fixture.enterpriseId,
      projectId: fixture.projectId,
    });

    // Creation grants for the Task/WorkOrder fixtures and the two Context
    // Snapshot entries; generic grants for the owning reads the build re-enters.
    await grant({
      capabilityCode: creationCapabilityCodes.taskV1,
      action: ACTIONS.taskV1,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: TASK_V1,
    });
    await grant({
      capabilityCode: creationCapabilityCodes.taskV2,
      action: ACTIONS.taskV2,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: TASK_V2,
    });
    await grant({
      capabilityCode: creationCapabilityCodes.workOrderV1,
      action: ACTIONS.workOrderV1,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: WORK_ORDER_V1,
    });
    await grant({
      capabilityCode: creationCapabilityCodes.workOrderV11,
      action: ACTIONS.workOrderV11,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: WORK_ORDER_V11,
    });
    grantCtxBuild = await grant({
      capabilityCode: contextSnapshotCapabilityCodes.contextSnapshotBuildV11,
      action: ACTIONS.ctxBuild,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: CONTEXT_SNAPSHOT_OBJECT,
    });
    grantCtxRead = await grant({
      capabilityCode: contextSnapshotCapabilityCodes.contextSnapshotRead,
      action: ACTIONS.ctxRead,
      selectorType: 'TARGET_TYPE',
      targetObjectType: CONTEXT_SNAPSHOT_OBJECT,
    });
    // The §15.9 DRAFT dependency read of the build, under its own capability.
    grantCtxDraftRead = await grant({
      capabilityCode: contextSnapshotCapabilityCodes.contextSnapshotDraftReadV11,
      action: ACTIONS.ctxDraftRead,
      selectorType: 'TARGET_TYPE',
      targetObjectType: DRAFT_SNAPSHOT_OBJECT,
    });
    grantResolve = await grantGeneric(dependencyCapabilities.resolvePolicy);
    grantSliceRead = await grantGeneric(dependencyCapabilities.readContextSourceSlice);
    await grantGeneric(CAPTURE_CAPABILITY);
    await grantGeneric(RECORD_CAPABILITY);

    // Builder Policies (Project scope, builder profile declared unless noted).
    await registerPolicyVersionAs({
      key: policyKey(BUILDER_POLICY.main, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:builder:main',
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference(BUILDER_PROFILE)],
      policyDocument: { allowedProjectionTypes: ['COORDINATOR'] },
    });
    await registerPolicyVersionAs({
      key: policyKey(BUILDER_POLICY.noProjection, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:builder:no-projection',
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference(BUILDER_PROFILE)],
      policyDocument: { allowedProjectionTypes: ['DOCUMENT_WRITER'] },
    });
    // Declares the *capture* profile, so the builder profile binding fails.
    await registerPolicyVersionAs({
      key: policyKey(BUILDER_POLICY.wrongProfile, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:builder:wrong-profile',
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference(CAPTURE_PROFILE)],
      policyDocument: { maxSliceValiditySeconds: 3600, allowedPurposeCodes: [PURPOSE_DOCUMENT] },
    });
    await registerPolicyVersionAs({
      key: policyKey(BUILDER_POLICY.future, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:builder:future',
      effectiveFrom: new Date(clock + 15 * 60 * 1000),
      policySchemaRefs: [profileReference(BUILDER_PROFILE)],
      policyDocument: { allowedProjectionTypes: ['COORDINATOR'] },
    });
    await registerPolicyVersionAs({
      key: policyKey(BUILDER_POLICY.supersededFirst, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:builder:superseded-first',
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference(BUILDER_PROFILE)],
      policyDocument: { allowedProjectionTypes: ['COORDINATOR'] },
    });
    await registerPolicyVersionAs({
      key: policyKey(BUILDER_POLICY.successor, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:builder:successor',
      effectiveFrom: new Date(clock - 30 * 60 * 1000),
      policySchemaRefs: [profileReference(BUILDER_PROFILE)],
      policyDocument: { allowedProjectionTypes: ['COORDINATOR'] },
      supersedesRef: policyKey(BUILDER_POLICY.supersededFirst, fixture),
    });
    await registerPolicyVersionAs({
      key: policyKey(BUILDER_POLICY.alt, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:builder:alt',
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference(BUILDER_PROFILE)],
      policyDocument: { allowedProjectionTypes: ['COORDINATOR'] },
    });

    // Capture Policies of the slice fixtures.
    await registerPolicyVersionAs({
      key: policyKey(CAPTURE_POLICY.main, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:capture:main',
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference(CAPTURE_PROFILE)],
      policyDocument: {
        maxSliceValiditySeconds: 3600,
        allowedPurposeCodes: [PURPOSE_DOCUMENT, PURPOSE_FORM, PURPOSE_REVIEW],
      },
    });
    await registerPolicyVersionAs({
      key: policyKey(CAPTURE_POLICY.ttl, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:capture:ttl',
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference(CAPTURE_PROFILE)],
      policyDocument: { maxSliceValiditySeconds: 120, allowedPurposeCodes: [PURPOSE_DOCUMENT] },
    });
    await registerPolicyVersionAs({
      key: policyKey(CAPTURE_POLICY.revokedFirst, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:capture:revoked-first',
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference(CAPTURE_PROFILE)],
      policyDocument: { maxSliceValiditySeconds: 3600, allowedPurposeCodes: [PURPOSE_DOCUMENT] },
    });

    sliceEntry = createContextSourceSliceEntry({
      enterpriseProjectDb,
      identity: { db: identityDb, repo: identityRepo, crypto },
      capabilities: {
        capture: CAPTURE_CAPABILITY,
        read: dependencyCapabilities.readContextSourceSlice,
        resolve: dependencyCapabilities.resolvePolicy,
      },
    });
    sliceSession = {
      authenticationContextHash: AUTH_HASH,
      policyResolutionActorSnapshotRef: operatorActorRef,
    };

    // Slice B is captured before any Fact exists; the two Facts are then
    // proposed and confirmed, and Slice A observes both as CONFIRMED.
    sliceBRef = await captureSlice({
      purpose: PURPOSE_DOCUMENT,
      capturePolicyRef: policyKey(CAPTURE_POLICY.main, fixture),
      idempotencyKey: 'wi216:slice:b',
    });
    factA1 = await proposeAndConfirmFact('a1', 'LOW');
    factA2 = await proposeAndConfirmFact('a2', 'MEDIUM');
    sliceARef = await captureSlice({
      purpose: PURPOSE_DOCUMENT,
      capturePolicyRef: policyKey(CAPTURE_POLICY.main, fixture),
      idempotencyKey: 'wi216:slice:a',
    });
    // record.form.read carries no Fact metadata: the ENTERPRISE_FACTS omission
    // is PURPOSE_FORBIDDEN, which drives coverage to PARTIAL.
    sliceCRef = await captureSlice({
      purpose: PURPOSE_FORM,
      capturePolicyRef: policyKey(CAPTURE_POLICY.main, fixture),
      idempotencyKey: 'wi216:slice:c',
    });
    sliceTTLRef = await captureSlice({
      purpose: PURPOSE_DOCUMENT,
      capturePolicyRef: policyKey(CAPTURE_POLICY.ttl, fixture),
      idempotencyKey: 'wi216:slice:ttl',
    });
    sliceRevokedRef = await captureSlice({
      purpose: PURPOSE_DOCUMENT,
      capturePolicyRef: policyKey(CAPTURE_POLICY.revokedFirst, fixture),
      idempotencyKey: 'wi216:slice:revoked',
    });
    // Superseding the capture Policy revokes every Slice captured under it.
    // The successor must already be effective at the suite's frozen trusted
    // instant: with a real-clock `effectiveFrom` the predecessor still
    // resolves as current at the entry's asOf and the Slice stays USABLE.
    await registerPolicyVersionAs({
      key: policyKey(CAPTURE_POLICY.successor, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:capture:successor',
      effectiveFrom: new Date(clock - 60_000),
      policySchemaRefs: [profileReference(CAPTURE_PROFILE)],
      policyDocument: { maxSliceValiditySeconds: 3600, allowedPurposeCodes: [PURPOSE_DOCUMENT] },
      supersedesRef: policyKey(CAPTURE_POLICY.revokedFirst, fixture),
    });
    // The mixed-state slice: fact A2 disputed by owner SQL (the same convention
    // task-readiness/work-order-draft use for owner-movable columns; the
    // enterprise_fact root has no status transition delivered in this slice and
    // the version immutable guard does not cover `status`).
    await admin.query(
      `UPDATE enterprise_project.enterprise_fact SET current_status = 'DISPUTED'
        WHERE enterprise_fact_id = $1`,
      [factA2.objectId],
    );
    await admin.query(
      `UPDATE enterprise_project.enterprise_fact_version SET status = 'DISPUTED'
        WHERE version_id = $1`,
      [factA2.versionId],
    );
    sliceMixRef = await captureSlice({
      purpose: PURPOSE_DOCUMENT,
      capturePolicyRef: policyKey(CAPTURE_POLICY.main, fixture),
      idempotencyKey: 'wi216:slice:mix',
    });

    initialContextEntry = entryFor();
    workOrderEntry = createWorkOrderDraftEntry({
      taskExecutionDb: teDb,
      identity: { db: identityDb, repo: identityRepo, crypto },
      capabilityCodes: creationCapabilityCodes,
      readCapabilityCodes: draftReadCapabilityCodes,
      now: (): Date => new Date(clock),
    });
    taskEntry = createCreateTaskEntry({
      taskExecutionDb: teDb,
      enterpriseProjectDb,
      identity: { db: identityDb, repo: identityRepo, crypto },
      capabilityCodes: creationCapabilityCodes,
      now: (): Date => new Date(clock),
    });

    // The golden WorkOrder: one @1.1 DRAFT every unit assembly input reuses.
    if (!deliveryOnly) {
      const goldenTaskId = await createExecutableTask('2.0');
      goldenWorkOrderId = await createWorkOrder({ taskId: goldenTaskId, taskMajor: '2.0' });
      goldenDraftRef = await draftSnapshotRefOf(goldenWorkOrderId);
    }
    phaseEnd();
  }

  async function dispose() {
    phase('suite cleanup');
    try {
      // Setup can fail before a pool exists. Close every initialized resource
      // even if another close fails, and preserve cleanup failures for Vitest.
      const settled = await Promise.allSettled(
        cleanupResources.splice(0).map((resource) => resource.end()),
      );
      const failures = settled.flatMap((result) =>
        result.status === 'rejected' ? [result.reason as unknown] : [],
      );
      if (failures.length) throw new AggregateError(failures, 'initial Context cleanup failed');
    } finally {
      phaseEnd();
    }
  }

  if (options.registerHooks !== false) {
    beforeAll(() => prepareSuite(), 300_000);
    afterEach(drain, 120_000);
    afterAll(dispose);
  }

  const NON_HUMAN_ONLY_CODES: readonly [string, string, string] = [
    'artifact.revision.create',
    'artifact.revision.delete',
    'execution.run.start',
  ];

  function capabilityGrant(
    capabilityType: string,
    actions: readonly string[],
    resourceSelectors: readonly string[],
    grantScope: Record<string, string>,
  ): Record<string, unknown> {
    return {
      capabilityType,
      actions: [...actions],
      resourceSelectors: [...resourceSelectors],
      constraints: [],
      expiresAt: new Date(clock + 365 * 24 * 60 * 60 * 1000).toISOString(),
      grantPolicyRef: {
        kind: 'VERSIONED',
        objectType: 'zhiju.identity.policy_snapshot',
        objectId: newUuidV7(),
        versionId: newUuidV7(),
        scope: grantScope,
      },
    };
  }

  function workOrderDraft(input: {
    taskId: string;
    taskMajor: '1.0' | '2.0';
  }): Record<string, unknown> {
    const contract = JSON.parse(readFileSync(WORK_ORDER_CONTRACT_FIXTURE, 'utf8')) as Record<
      string,
      unknown
    >;
    const omitted = [
      'header',
      'workOrderRef',
      'taskRef',
      'projectRef',
      'contextSnapshotRef',
      'issuedAt',
      'expiresAt',
      'specificationHash',
    ];
    const draft = Object.fromEntries(
      Object.entries(structuredClone(contract)).filter(([key]) => !omitted.includes(key)),
    );
    rewriteFixtureScopes(draft, fixture);
    draft.taskRef = objectRef(input.taskMajor === '2.0' ? TASK_V2 : TASK_V1, input.taskId, scope());
    draft.requestedBy = { principalId: OPERATOR, principalKind: 'HUMAN' };
    draft.allowedCapabilities = [
      capabilityGrant(
        NON_HUMAN_ONLY_CODES[0],
        ['read', 'create'],
        ['zhiju.artifact.artifact_revision'],
        scope(),
      ),
    ];
    draft.deniedCapabilities = [
      capabilityGrant(NON_HUMAN_ONLY_CODES[1], ['delete'], ['zhiju.artifact.*'], scope()),
    ];
    return draft;
  }

  function initialWorkOrderDraft(input: {
    taskId: string;
    taskMajor: '1.0' | '2.0';
    inputRefs?: Record<string, unknown>[];
    builderPolicyPair?: readonly [string, string];
    targetObjectRefs?: Record<string, unknown>[];
  }): Record<string, unknown> {
    const draft = workOrderDraft(input);
    const versionPins = { ...record(draft.versionPins) };
    delete versionPins.projectContextContractRef;
    versionPins.contextBuilderPolicyRef = policyKey(
      input.builderPolicyPair ?? BUILDER_POLICY.main,
      fixture,
    );
    draft.versionPins = versionPins;
    const targetScope = { ...record(draft.targetScope) };
    targetScope.targetObjectRefs = input.targetObjectRefs ?? [];
    draft.targetScope = targetScope;
    draft.inputRefs = input.inputRefs ?? [];
    return draft;
  }

  async function createExecutableTask(
    commandVersion: '1.0' | '2.0',
    owningReady = false,
    formalDefinition?: Record<string, unknown>,
    deferReadiness = false,
    preallocatedId?: string,
  ): Promise<string> {
    const payload = payloadOf(commandVersion === '1.0' ? V1_TASK_FIXTURE : V2_TASK_FIXTURE);
    rewriteFixtureScopes(payload, fixture);
    (payload.projectRef as Record<string, unknown>).objectId = fixture.projectId;
    delete record(payload.definition).deliveryItemRef;
    if (owningReady) {
      delete record(payload.definition).parentTaskRef;
      record(payload.definition).dependencyTaskRefs = [];
      record(payload.definition).inputRefs = [];
    }
    if (formalDefinition) Object.assign(record(payload.definition), formalDefinition);
    const binding = TASK_DRAFT_CREATION_BINDINGS.find(
      (candidate) => candidate.commandVersion === commandVersion,
    );
    if (binding === undefined) throw new Error('unsupported Task creation version');
    const targetId = preallocatedId ?? newUuidV7();
    const digest = digestCanonicalPayload(payload as CanonicalJsonObject);
    const port = createTaskExecutionCreationAuthorizationPort({
      capabilityCodes: creationCapabilityCodes,
      now: (): Date => new Date(clock),
    });
    const view = await track(
      port.authorizeCreation(identityDeps([fixture.projectId]), {
        actorSnapshotRef: operatorActorRef,
        commandType: 'execution.create_task',
        commandVersion,
        targetRef: objectRef(
          binding.taskObjectType,
          targetId,
          scope(),
        ) as unknown as Common.ObjectRef,
        commandPayloadHash: digest.hash,
        authenticationContextHash: AUTH_HASH,
      }),
    );
    expect(view.outcome, JSON.stringify(view)).toBe('ALLOW');
    if (view.authorizationDecisionRef === undefined) {
      throw new Error('the Task creation Decision was not issued');
    }
    const result = await track(
      taskEntry.create(
        {
          commandId: newUuidV7(),
          commandType: 'execution.create_task',
          commandVersion,
          scopeRef: scope(),
          targetRef: objectRef(binding.taskObjectType, targetId, scope()),
          actor: {
            kind: 'SNAPSHOT',
            objectType: ACTOR_SNAPSHOT_OBJECT,
            objectId: operatorActorRef.snapshotId,
            snapshotId: operatorActorRef.snapshotId,
            scope: scope(),
            contentHash: operatorActorRef.contentHash,
          },
          authorizationDecisionRef: view.authorizationDecisionRef,
          idempotencyKey: `wi216-task-${commandVersion}-${targetId}`,
          correlationId: newUuidV7(),
          requestedAt: new Date(clock).toISOString(),
          payload,
          integrity: {
            canonicalizationVersion: '1',
            payloadHash: contentHash(digest.hash.toString('hex')),
          },
        },
        { authenticationContextHash: AUTH_HASH },
      ),
    );
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'COMMITTED' });
    if (deferReadiness) return targetId;
    if (owningReady) {
      await readyTaskForValidation(targetId);
      return targetId;
    }
    await track(
      admin.query('UPDATE task_execution.task SET status = $2 WHERE task_id = $1', [
        targetId,
        'READY',
      ]),
    );
    return targetId;
  }

  async function createWorkOrderResult(input: {
    customDraft?: Record<string, unknown>;
    taskId: string;
    taskMajor: '1.0' | '2.0';
    commandVersion?: '1.0' | '1.1';
    inputRefs?: Record<string, unknown>[];
    builderPolicyPair?: readonly [string, string];
    targetObjectRefs?: Record<string, unknown>[];
    expiresAt?: string;
  }): Promise<{ result: CommandResult; targetId: string }> {
    const commandVersion = input.commandVersion ?? '1.1';
    const draft =
      input.customDraft ??
      (commandVersion === '1.1'
        ? initialWorkOrderDraft(input)
        : workOrderDraft({ taskId: input.taskId, taskMajor: input.taskMajor }));
    const payload = {
      draft,
      expiresAt: input.expiresAt ?? new Date(clock + 24 * 60 * 60 * 1000).toISOString(),
    };
    const digest = digestCanonicalPayload(payload as CanonicalJsonObject);
    const targetId = newUuidV7();
    const targetType = commandVersion === '1.1' ? WORK_ORDER_V11 : WORK_ORDER_V1;
    const port = createTaskExecutionCreationAuthorizationPort({
      capabilityCodes: creationCapabilityCodes,
      now: (): Date => new Date(clock),
    });
    const view = await track(
      port.authorizeCreation(identityDeps([fixture.projectId]), {
        actorSnapshotRef: operatorActorRef,
        commandType: 'execution.create_work_order',
        commandVersion,
        targetRef: objectRef(targetType, targetId, scope()) as unknown as Common.ObjectRef,
        commandPayloadHash: digest.hash,
        authenticationContextHash: AUTH_HASH,
      }),
    );
    expect(view.outcome, JSON.stringify(view)).toBe('ALLOW');
    if (view.authorizationDecisionRef === undefined) {
      throw new Error('the WorkOrder creation Decision was not issued');
    }
    const result = await track(
      workOrderEntry.create(
        {
          commandId: newUuidV7(),
          commandType: 'execution.create_work_order',
          commandVersion,
          scopeRef: scope(),
          targetRef: objectRef(targetType, targetId, scope()),
          actor: {
            kind: 'SNAPSHOT',
            objectType: ACTOR_SNAPSHOT_OBJECT,
            objectId: operatorActorRef.snapshotId,
            snapshotId: operatorActorRef.snapshotId,
            scope: scope(),
            contentHash: operatorActorRef.contentHash,
          },
          authorizationDecisionRef: view.authorizationDecisionRef,
          idempotencyKey: `wi216-workorder-${commandVersion}-${targetId}`,
          correlationId: newUuidV7(),
          requestedAt: new Date(clock).toISOString(),
          payload,
          integrity: {
            canonicalizationVersion: '1',
            payloadHash: contentHash(digest.hash.toString('hex')),
          },
        },
        { authenticationContextHash: AUTH_HASH },
      ),
    );
    return { result, targetId };
  }

  async function createWorkOrder(
    input: Parameters<typeof createWorkOrderResult>[0],
  ): Promise<string> {
    const { result, targetId } = await createWorkOrderResult(input);
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'COMMITTED' });
    return targetId;
  }

  async function draftSnapshotRefOf(workOrderId: string): Promise<Common.ContentAddressedRef> {
    const row = (
      await admin.query<{
        current_draft_snapshot_id: string;
        current_draft_snapshot_hash: Buffer;
      }>(
        `SELECT current_draft_snapshot_id::text, current_draft_snapshot_hash
           FROM task_execution.work_order WHERE work_order_id = $1`,
        [workOrderId],
      )
    ).rows.at(0);
    if (row === undefined) throw new Error(`WorkOrder ${workOrderId} missing`);
    return {
      kind: 'CONTENT_ADDRESSED',
      objectType: DRAFT_SNAPSHOT_OBJECT,
      objectId: row.current_draft_snapshot_id,
      scope: scope(),
      contentHash: contentHash(row.current_draft_snapshot_hash.toString('hex')),
    } as unknown as Common.ContentAddressedRef;
  }

  async function issueBuildDecision(input: {
    targetId: string;
    payloadHash: Buffer;
    principal?: Principal;
    now?: Date;
    capabilityCodes?: TaskExecutionContextSnapshotCapabilityCodes;
    commandType?: string;
    commandVersion?: string;
    targetObjectType?: string;
  }): Promise<Common.ContentAddressedRef> {
    const principal = input.principal ?? operator();
    const port = createTaskExecutionContextSnapshotAuthorizationPort({
      capabilityCodes: input.capabilityCodes ?? contextSnapshotCapabilityCodes,
      now: (): Date => input.now ?? new Date(clock),
    });
    const view = await track(
      port.authorizeContextSnapshot(identityDeps([fixture.projectId], principal), {
        actorSnapshotRef: principal.actorRef,
        commandType: input.commandType ?? BUILD_COMMAND,
        commandVersion: input.commandVersion ?? BUILD_VERSION,
        targetRef: objectRef(
          input.targetObjectType ?? CONTEXT_SNAPSHOT_OBJECT,
          input.targetId,
          scope(),
        ) as unknown as Common.ObjectRef,
        commandPayloadHash: input.payloadHash,
        authenticationContextHash: principal.authHash,
      }),
    );
    expect(view.outcome, JSON.stringify(view)).toBe('ALLOW');
    if (view.authorizationDecisionRef === undefined) {
      throw new Error('the build Decision was not issued');
    }
    return view.authorizationDecisionRef;
  }

  async function issueReadDecision(input: {
    targetId: string;
    payloadHash: Buffer;
    principal?: Principal;
    now?: Date;
    capabilityCodes?: TaskExecutionContextSnapshotCapabilityCodes;
    targetObjectType?: string;
  }): Promise<Common.ContentAddressedRef> {
    const principal = input.principal ?? operator();
    const port = createTaskExecutionContextSnapshotAuthorizationPort({
      capabilityCodes: input.capabilityCodes ?? contextSnapshotCapabilityCodes,
      now: (): Date => input.now ?? new Date(clock),
    });
    const view = await track(
      port.authorizeContextSnapshot(identityDeps([fixture.projectId], principal), {
        actorSnapshotRef: principal.actorRef,
        commandType: READ_QUERY,
        commandVersion: READ_VERSION,
        targetRef: objectRef(
          input.targetObjectType ?? CONTEXT_SNAPSHOT_OBJECT,
          input.targetId,
          scope(),
        ) as unknown as Common.ObjectRef,
        commandPayloadHash: input.payloadHash,
        authenticationContextHash: principal.authHash,
      }),
    );
    expect(view.outcome, JSON.stringify(view)).toBe('ALLOW');
    if (view.authorizationDecisionRef === undefined) {
      throw new Error('the read Decision was not issued');
    }
    return view.authorizationDecisionRef;
  }

  async function preparedBuild(input: BuildInput): Promise<Record<string, unknown>> {
    const principal = input.principal ?? operator();
    const targetId = input.targetId ?? newUuidV7();
    const request: Record<string, unknown> = {
      draftSnapshotRef:
        input.draftRef ?? (await draftSnapshotRefOf(input.workOrderId ?? goldenWorkOrderId)),
      projectionType: input.projectionType ?? 'COORDINATOR',
      purpose: input.purpose ?? PURPOSE_DOCUMENT,
      audience: input.audience ?? {
        principalId: principal.principalId,
        principalKind: principal.principalKind,
      },
      sourceSlices: input.sourceSlices ?? [sliceARef],
      builderPolicyRef: input.builderPolicyRef ?? policyKey(BUILDER_POLICY.main, fixture),
    };
    if (input.expiry?.present === true) request.expiresAt = input.expiry.value;
    input.requestMutate?.(request);
    const payload = { request };
    const digest = digestCanonicalPayload(payload as CanonicalJsonObject);
    const decisionRef = await issueBuildDecision({
      targetId,
      payloadHash: digest.hash,
      principal,
      ...(input.decisionNow === undefined ? {} : { now: input.decisionNow }),
      ...(input.commandVersion === undefined ? {} : { commandVersion: input.commandVersion }),
    });
    return {
      commandId: input.commandId ?? newUuidV7(),
      commandType: BUILD_COMMAND,
      commandVersion: input.commandVersion ?? BUILD_VERSION,
      scopeRef: scope(),
      targetRef: objectRef(CONTEXT_SNAPSHOT_OBJECT, targetId, scope()),
      actor: {
        kind: 'SNAPSHOT',
        objectType: ACTOR_SNAPSHOT_OBJECT,
        objectId: principal.actorRef.snapshotId,
        snapshotId: principal.actorRef.snapshotId,
        scope: scope(),
        contentHash: principal.actorRef.contentHash,
      },
      authorizationDecisionRef: decisionRef,
      idempotencyKey: input.idempotencyKey,
      correlationId: newUuidV7(),
      requestedAt: new Date(clock).toISOString(),
      payload,
      integrity: {
        canonicalizationVersion: '1',
        payloadHash: contentHash(digest.hash.toString('hex')),
      },
    };
  }

  async function attemptBuild(
    envelope: unknown,
    target: InitialContextEntry = initialContextEntry,
    principal: Principal = operator(),
  ): Promise<{ code: string; thrown: boolean; result?: CommandResult }> {
    try {
      const result = await track(target.build(envelope, sessionFor(principal)));
      return { code: resultCode(result), thrown: false, result };
    } catch (error) {
      return { code: failureOf(error).code, thrown: true };
    }
  }

  function contextSnapshotRefOf(result: CommandResult): Common.SnapshotRef {
    const payload = result.status === 'DUPLICATE' ? result.resultPayload : committedPayload(result);
    return record(record(payload).data).contextSnapshotRef as Common.SnapshotRef;
  }

  function readEnvelope(input: {
    snapshotRef: unknown;
    decisionRef: Common.ContentAddressedRef;
    principal?: Principal;
    consistencyRequirement?: string;
  }): Record<string, unknown> {
    const principal = input.principal ?? operator();
    return {
      queryId: newUuidV7(),
      queryType: READ_QUERY,
      queryVersion: READ_VERSION,
      scopeRef: scope(),
      requester: {
        kind: 'OBJECT',
        objectType: PRINCIPAL_OBJECT,
        objectId: principal.principalId,
        scope: scope(),
      },
      authenticationContextRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: AUTH_CONTEXT_OBJECT,
        objectId: AUTH_CONTEXT_ID,
        scope: scope(),
        contentHash: contentHash(principal.authHash.toString('hex')),
      },
      authorizationDecisionRef: input.decisionRef,
      consistencyRequirement: input.consistencyRequirement ?? 'AUTHORITATIVE',
      correlationId: newUuidV7(),
      requestedAt: new Date(clock).toISOString(),
      payload: { contextSnapshotRef: input.snapshotRef },
    };
  }

  async function preparedRead(input: {
    snapshotRef: Common.SnapshotRef;
    principal?: Principal;
    now?: Date;
    capabilityCodes?: TaskExecutionContextSnapshotCapabilityCodes;
    targetObjectType?: string;
    refOverride?: unknown;
  }): Promise<Record<string, unknown>> {
    const principal = input.principal ?? operator();
    const presentedRef = input.refOverride ?? input.snapshotRef;
    const digest = digestCanonicalPayload({
      contextSnapshotRef: presentedRef,
    } as unknown as CanonicalJsonObject);
    const targetId = record(presentedRef).objectId as string;
    const decisionRef = await issueReadDecision({
      targetId,
      payloadHash: digest.hash,
      principal,
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.capabilityCodes === undefined ? {} : { capabilityCodes: input.capabilityCodes }),
      ...(input.targetObjectType === undefined ? {} : { targetObjectType: input.targetObjectType }),
    });
    return readEnvelope({ snapshotRef: presentedRef, decisionRef, principal });
  }

  async function attemptRead(
    envelope: unknown,
    target: InitialContextEntry = initialContextEntry,
    principal: Principal = operator(),
  ): Promise<{ code: string; thrown: boolean; result?: CommandResult }> {
    try {
      const result = await track(target.read(envelope, sessionFor(principal)));
      return { code: resultCode(result), thrown: false, result };
    } catch (error) {
      return { code: failureOf(error).code, thrown: true };
    }
  }

  async function contextSnapshotRow(objectId: string) {
    return (
      await admin.query<{
        snapshot_id: string;
        object_id: string;
        purpose: string;
        audience: string;
        enterprise_id: string;
        project_id: string;
        builder_version: string;
        policy_snapshot_id: string;
        source_manifest_count: number;
        context_item_count: number;
        omission_count: number;
        redaction_count: number;
        coverage_state: string;
        payload_hash: Buffer;
        canonicalization_version: string;
        payload_hash_algorithm: string;
        expires_at: Date | null;
        effective_expires_at: Date | null;
        request_payload_hash: Buffer;
        source_command_id: string;
        created_by_principal_id: string;
        canonical_payload: Record<string, unknown>;
      }>(
        `SELECT snapshot_id::text, object_id::text, purpose, audience,
                enterprise_id::text, project_id::text, builder_version,
                policy_snapshot_id::text, source_manifest_count, context_item_count,
                omission_count, redaction_count, coverage_state, payload_hash,
                canonicalization_version, payload_hash_algorithm, expires_at,
                effective_expires_at, request_payload_hash, source_command_id::text,
                created_by_principal_id::text, canonical_payload
           FROM task_execution.context_snapshot WHERE object_id = $1`,
        [objectId],
      )
    ).rows.at(0);
  }

  async function contextSnapshotBuildRow(snapshotId: string) {
    return (
      await admin.query<{
        snapshot_id: string;
        build_kind: string;
        draft_snapshot_ref: Record<string, unknown>;
        frozen_contract_ref: Record<string, unknown> | null;
        slice_refs: Record<string, unknown>[];
        purpose: string;
        audience: Record<string, unknown>;
        builder_policy_ref: Record<string, unknown>;
        policy_content_hash: Buffer;
        policy_effective_from: Date;
        policy_superseded_at: Date | null;
        request_expires_at: Date | null;
        effective_expires_at: Date | null;
        canonical_payload: Record<string, unknown>;
        payload_hash: Buffer;
        request_payload_hash: Buffer;
        source_command_id: string;
        enterprise_id: string;
        project_id: string;
        created_by_principal_id: string;
      }>(
        `SELECT snapshot_id::text, build_kind, draft_snapshot_ref, frozen_contract_ref,
                slice_refs, purpose, audience, builder_policy_ref, policy_content_hash,
                policy_effective_from, policy_superseded_at, request_expires_at,
                effective_expires_at, canonical_payload, payload_hash, request_payload_hash,
                source_command_id::text, enterprise_id::text, project_id::text,
                created_by_principal_id::text
           FROM task_execution.context_snapshot_build WHERE snapshot_id = $1`,
        [snapshotId],
      )
    ).rows.at(0);
  }

  async function receiptRows(idempotencyKey: string) {
    return (
      await admin.query<{
        command_id: string;
        command_type: string;
        command_version: string;
        outcome: string;
        target_type: string | null;
        target_id: string | null;
        result_payload: Record<string, unknown> | null;
      }>(
        `SELECT command_id::text, command_type, command_version, outcome, target_type,
                target_id::text, result_payload
           FROM task_execution.command_receipt WHERE idempotency_key = $1`,
        [idempotencyKey],
      )
    ).rows;
  }

  async function auditRows(commandId: string) {
    return (
      await admin.query<{
        outcome: string;
        error_code: string | null;
        safe_summary: string | null;
      }>(
        `SELECT outcome, error_code, safe_summary FROM task_execution.audit_record
          WHERE command_id = $1 ORDER BY recorded_at`,
        [commandId],
      )
    ).rows;
  }

  async function countRows(table: string): Promise<number> {
    const row = (
      await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)
    ).rows.at(0);
    return row?.n ?? -1;
  }

  async function edgeRows(ownerId: string) {
    return (
      await admin.query<{
        reference_path: string;
        target_object_type: string;
        target_module: string;
        owner_version_id: string;
        target_object_id: string;
      }>(
        `SELECT reference_path, target_object_type, target_module,
                owner_version_id::text, target_object_id::text
           FROM task_execution.reference_edge
          WHERE owner_object_id = $1 ORDER BY reference_path`,
        [ownerId],
      )
    ).rows;
  }

  async function outboxRows(aggregateId: string) {
    return (
      await admin.query<{
        event_id: string;
        event_type: string;
        event_version: string;
        aggregate_version: string;
        correlation_id: string;
        causation_id: string | null;
        source_command_id: string;
        payload: Record<string, unknown>;
        payload_hash: Buffer;
        canonicalization_version: string;
        occurred_at: Date;
        created_by_principal_id: string;
      }>(
        `SELECT event_id::text, event_type, event_version, aggregate_version::text,
                correlation_id::text, causation_id::text, source_command_id::text,
                payload, payload_hash, canonicalization_version, occurred_at,
                created_by_principal_id::text
           FROM task_execution.outbox_event WHERE aggregate_id = $1 ORDER BY recorded_at`,
        [aggregateId],
      )
    ).rows;
  }

  async function ipDraftReadDeniedAudits(principalId: string, targetObjectId: string) {
    return (
      await admin.query<{
        outcome: string;
        error_code: string | null;
        command_type: string;
        target_type: string | null;
        target_id: string | null;
        principal_id: string;
        safe_summary: string | null;
      }>(
        `SELECT outcome, error_code, command_type, target_type, target_id::text,
                principal_id::text, safe_summary
           FROM identity_policy.audit_record
          WHERE command_type = $1 AND principal_id = $2 AND target_id = $3
          ORDER BY recorded_at`,
        [BUILD_COMMAND, principalId, targetObjectId],
      )
    ).rows;
  }

  async function draftReadDecisionRows() {
    return (
      await admin.query<{
        authorization_decision_id: string;
        command_type: string;
        command_version: string;
        purpose: string;
        requested_capability: string;
        target_object_type: string | null;
        target_object_id: string | null;
        command_payload_hash: Buffer;
        policy_snapshot_id: string;
        principal_id: string;
        actor_snapshot_id: string;
        canonical_payload: Record<string, unknown>;
      }>(
        `SELECT authorization_decision_id::text, command_type, command_version, purpose,
                requested_capability, target_object_type, target_object_id::text,
                command_payload_hash, policy_snapshot_id::text, principal_id::text,
                actor_snapshot_id::text, canonical_payload
           FROM identity_policy.authorization_decision
          WHERE requested_capability = $1
          ORDER BY created_at`,
        [contextSnapshotCapabilityCodes.contextSnapshotDraftReadV11],
      )
    ).rows;
  }

  async function teFactCounts(): Promise<{
    snapshots: number;
    builds: number;
    receipts: number;
    audits: number;
    outbox: number;
  }> {
    return {
      snapshots: await countRows('task_execution.context_snapshot'),
      builds: await countRows('task_execution.context_snapshot_build'),
      receipts: await countRows('task_execution.command_receipt'),
      audits: await countRows('task_execution.audit_record'),
      outbox: await countRows('task_execution.outbox_event'),
    };
  }

  async function slicePayloadOf(sliceId: string): Promise<Record<string, unknown>> {
    const row = (
      await admin.query<{ slice_payload: Record<string, unknown> }>(
        'SELECT slice_payload FROM enterprise_project.context_source_slice WHERE slice_id = $1',
        [sliceId],
      )
    ).rows.at(0);
    if (row === undefined) throw new Error(`slice ${sliceId} missing`);
    return row.slice_payload;
  }

  async function draftPayloadOf(workOrderId: string): Promise<Record<string, unknown>> {
    const row = (
      await admin.query<{ canonical_payload: Record<string, unknown> }>(
        `SELECT canonical_payload FROM task_execution.work_order_draft_snapshot
          WHERE work_order_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [workOrderId],
      )
    ).rows.at(0);
    if (row === undefined) throw new Error(`draft snapshot of ${workOrderId} missing`);
    return row.canonical_payload;
  }

  async function policyVersionRow(pair: readonly [string, string]) {
    const row = (
      await admin.query<{
        payload_hash: Buffer;
        effective_from: Date;
        canonical_payload: Record<string, unknown>;
      }>(
        `SELECT payload_hash, effective_from, canonical_payload
           FROM identity_policy.policy_version
          WHERE policy_object_id = $1 AND policy_key_version_id = $2`,
        [pair[0], pair[1]],
      )
    ).rows.at(0);
    if (row === undefined) throw new Error(`policy version ${pair[1]} missing`);
    return row;
  }

  async function expectNoContextSnapshot(
    targetId: string,
    idempotencyKey?: string,
    receipt: 'REJECTED_OR_ABSENT' | 'ABSENT' = 'REJECTED_OR_ABSENT',
  ): Promise<void> {
    expect(await contextSnapshotRow(targetId)).toBeUndefined();
    if (idempotencyKey === undefined) return;
    const receipts = await receiptRows(idempotencyKey);
    if (receipt === 'ABSENT') {
      expect(receipts).toEqual([]);
      return;
    }
    expect(receipts.every((row) => row.outcome === 'REJECTED')).toBe(true);
  }

  async function establish(client: pg.PoolClient, context: AppRoleContext): Promise<void> {
    await client.query(
      `SELECT platform_security.establish_transaction_context(
         'REQUEST', $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)`,
      [
        context.principalId ?? OPERATOR,
        context.principalKind ?? 'HUMAN',
        context.actorSnapshotId ?? OPERATOR_ACTOR,
        REQUEST_DECISION,
        DECISION_HASH,
        new Date(clock + 60 * 60 * 1000),
        context.enterpriseId ?? fixture.enterpriseId,
        [...context.allowedProjectIds],
        CORRELATION,
      ],
    );
  }

  async function asAppRole<T>(
    pool: pg.Pool,
    role: string,
    context: AppRoleContext,
    work: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE platform_context_establisher');
      await establish(client, context);
      await client.query(`SET LOCAL ROLE ${role}`);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  function appStatement(
    statement: string,
    parameters: readonly unknown[],
    context: Partial<AppRoleContext> = {},
  ): Promise<{ code: string; message: string } | null> {
    return track(appStatementCore(statement, parameters, context));
  }

  async function appStatementCore(
    statement: string,
    parameters: readonly unknown[],
    context: Partial<AppRoleContext>,
  ): Promise<{ code: string; message: string } | null> {
    try {
      await asAppRole(
        tePool,
        'task_execution_app',
        {
          allowedProjectIds: [fixture.projectId],
          ...context,
        },
        (client) => client.query(statement, [...parameters]),
      );
      return null;
    } catch (error) {
      return failureOf(error);
    }
  }

  async function legacySnapshotRow(objectId: string) {
    return (
      await admin.query<{
        snapshot_id: string;
        object_type: string;
        object_id: string;
        enterprise_id: string;
        project_id: string;
        payload_hash: Buffer;
        payload_hash_algorithm: string;
        canonicalization_version: string;
        canonical_payload: Record<string, unknown>;
        project_context_contract: Record<string, unknown>;
        contract_ref: Record<string, unknown>;
        import_manifest_id: string;
        import_batch_id: string;
        source_system: string;
        imported_at: Date;
        import_tool_version: string;
      }>(
        `SELECT snapshot_id::text, object_type, object_id::text, enterprise_id::text,
                project_id::text, payload_hash, payload_hash_algorithm,
                canonicalization_version, canonical_payload, project_context_contract,
                contract_ref, import_manifest_id, import_batch_id, source_system,
                imported_at, import_tool_version
           FROM task_execution.context_snapshot_legacy WHERE object_id = $1`,
        [objectId],
      )
    ).rows.at(0);
  }

  function importLegacySnapshot(
    row: LegacyImportRow,
    context: Partial<AppRoleContext> = {},
  ): Promise<{ code: string; message: string } | null> {
    return track(importLegacySnapshotCore(row, context));
  }

  async function importLegacySnapshotCore(
    row: LegacyImportRow,
    context: Partial<AppRoleContext>,
  ): Promise<{ code: string; message: string } | null> {
    try {
      await admin.query('BEGIN');
      await admin.query('SET LOCAL ROLE platform_context_establisher');
      await admin.query(
        `SELECT platform_security.establish_transaction_context(
           'REQUEST', $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)`,
        [
          context.principalId ?? OPERATOR,
          context.principalKind ?? 'HUMAN',
          context.actorSnapshotId ?? OPERATOR_ACTOR,
          REQUEST_DECISION,
          DECISION_HASH,
          new Date(clock + 60 * 60 * 1000),
          context.enterpriseId ?? fixture.enterpriseId,
          [...(context.allowedProjectIds ?? [fixture.projectId])],
          CORRELATION,
        ],
      );
      await admin.query('SET LOCAL ROLE task_execution_owner');
      await admin.query(
        `INSERT INTO task_execution.context_snapshot_legacy (
           snapshot_id, object_type, object_id, enterprise_id, project_id,
           payload_hash, payload_hash_algorithm, canonicalization_version,
           canonical_payload, project_context_contract, contract_ref,
           import_manifest_id, import_batch_id, source_system, imported_at,
           import_tool_version)
         VALUES ($1, $2, $3, $4, $5, $6, 'SHA-256', '1', $7::jsonb, $8::jsonb,
                 $9::jsonb, $10, $11, $12, $13, $14)`,
        [
          row.snapshotId,
          row.objectType ?? CONTEXT_SNAPSHOT_LEGACY_OBJECT,
          row.objectId,
          row.enterpriseId,
          row.projectId,
          row.payloadHash,
          JSON.stringify(row.canonicalPayload),
          JSON.stringify(row.projectContextContract),
          JSON.stringify(row.contractRef),
          row.provenance?.manifestId ?? 'wi216-legacy-import-manifest',
          row.provenance?.batchId ?? 'wi216-legacy-import-batch',
          row.provenance?.sourceSystem ?? 'wi216-legacy-source-system',
          new Date(clock).toISOString(),
          row.provenance?.toolVersion ?? 'wi216-import-tool-1.0.0',
        ],
      );
      await admin.query('COMMIT');
      return null;
    } catch (error) {
      return failureOf(error);
    } finally {
      await admin.query('ROLLBACK').catch(() => undefined);
      await admin.query('RESET ROLE').catch(() => undefined);
    }
  }

  function ownerStatement(
    statement: string,
    parameters: readonly unknown[],
    context: Partial<AppRoleContext> = {},
  ): Promise<{ failure: { code: string; message: string } | null; rowCount: number | null }> {
    return track(ownerStatementCore(statement, parameters, context));
  }

  async function ownerStatementCore(
    statement: string,
    parameters: readonly unknown[],
    context: Partial<AppRoleContext>,
  ): Promise<{ failure: { code: string; message: string } | null; rowCount: number | null }> {
    let rowCount: number | null = null;
    try {
      await admin.query('BEGIN');
      await admin.query('SET LOCAL ROLE platform_context_establisher');
      await admin.query(
        `SELECT platform_security.establish_transaction_context(
           'REQUEST', $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)`,
        [
          context.principalId ?? OPERATOR,
          context.principalKind ?? 'HUMAN',
          context.actorSnapshotId ?? OPERATOR_ACTOR,
          REQUEST_DECISION,
          DECISION_HASH,
          new Date(clock + 60 * 60 * 1000),
          context.enterpriseId ?? fixture.enterpriseId,
          [...(context.allowedProjectIds ?? [fixture.projectId])],
          CORRELATION,
        ],
      );
      await admin.query('SET LOCAL ROLE task_execution_owner');
      rowCount = (await admin.query(statement, [...parameters])).rowCount;
      await admin.query('COMMIT');
      return { failure: null, rowCount };
    } catch (error) {
      return { failure: failureOf(error), rowCount };
    } finally {
      await admin.query('ROLLBACK').catch(() => undefined);
      await admin.query('RESET ROLE').catch(() => undefined);
    }
  }

  function legacyFixtureOf(
    storedPayload: Record<string, unknown>,
    legacySnapshotId: string,
  ): { payload: Record<string, unknown>; digest: string } {
    const payload = structuredClone(storedPayload);
    payload.contextSnapshotId = legacySnapshotId;
    const header = record(payload.header);
    header.contractId = legacySnapshotId;
    const schemaRef = record(header.schemaRef);
    schemaRef.objectId = legacySnapshotId;
    schemaRef.versionId = legacySnapshotId;
    const digest = digestCanonicalPayload(payload as CanonicalJsonObject).hash.toString('hex');
    return { payload, digest };
  }

  function legacySnapshotRefOf(
    legacyObjectId: string,
    legacySnapshotId: string,
    digest: string,
  ): Common.SnapshotRef {
    return {
      kind: 'SNAPSHOT',
      objectType: CONTEXT_SNAPSHOT_LEGACY_OBJECT,
      objectId: legacyObjectId,
      snapshotId: legacySnapshotId,
      scope: scope(),
      contentHash: contentHash(digest),
    } as unknown as Common.SnapshotRef;
  }

  function closedContractRef(snapshotId: string, digest: string): Record<string, unknown> {
    return {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'zhiju.contract.project_context',
      objectId: snapshotId,
      scope: scope(),
      contentHash: contentHash(digest),
    };
  }

  async function unitAssemblyInput(
    overrides: {
      slices?: { ref: Common.ContentAddressedRef; slice: Record<string, unknown> }[];
      draftMutate?: (draft: Record<string, unknown>) => void;
      requestMutate?: (request: Record<string, unknown>) => void;
      policyMutate?: (policy: Record<string, unknown>) => void;
      workOrderId?: string;
      asOf?: string;
    } = {},
  ): Promise<AssemblyInput> {
    const storedDraftPayload = await draftPayloadOf(overrides.workOrderId ?? goldenWorkOrderId);
    const draft = structuredClone(record(storedDraftPayload.draft));
    overrides.draftMutate?.(draft);
    const slices = (
      overrides.slices ?? [
        { ref: sliceBRef, slice: await slicePayloadOf(sliceBRef.objectId) },
        { ref: sliceARef, slice: await slicePayloadOf(sliceARef.objectId) },
      ]
    ).map((entry) => ({
      ref: entry.ref as unknown as CanonicalJsonObject,
      slice: entry.slice as CanonicalJsonObject,
    }));
    const policyRow = await policyVersionRow(BUILDER_POLICY.main);
    const policyPayload = record(policyRow.canonical_payload);
    const policy: Record<string, unknown> = {
      resolvedRef: policyKey(BUILDER_POLICY.main, fixture),
      contentHashDigest: policyRow.payload_hash.toString('hex'),
      effectiveFrom: policyRow.effective_from.toISOString(),
      policySchemaRefs: policyPayload.policySchemaRefs,
      policyDocument: policyPayload.policyDocument,
    };
    overrides.policyMutate?.(policy);
    const request: Record<string, unknown> = {
      draftSnapshotRef: goldenDraftRef,
      projectionType: 'COORDINATOR',
      purpose: PURPOSE_DOCUMENT,
      audience: { principalId: OPERATOR, principalKind: 'HUMAN' },
      builderPolicyRef: policyKey(BUILDER_POLICY.main, fixture),
    };
    overrides.requestMutate?.(request);
    return {
      request: request as unknown as AssemblyInput['request'],
      draft: {
        workOrderRef: storedDraftPayload.workOrderRef as CanonicalJsonObject,
        taskRef: storedDraftPayload.taskRef as CanonicalJsonObject,
        scopeRef: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
        draft,
        ...(Object.hasOwn(storedDraftPayload, 'expiresAt')
          ? { expiresAt: storedDraftPayload.expiresAt as string }
          : {}),
      },
      slices,
      policy: policy as unknown as AssemblyInput['policy'],
      snapshotId: newUuidV7(),
      asOf: overrides.asOf ?? new Date(clock).toISOString(),
      correlationId: newUuidV7(),
      issuedBy: { principalId: OPERATOR, principalKind: 'HUMAN' },
    };
  }

  function recomputeContextItemId(
    asOfMilliseconds: number,
    factItem: unknown,
    sliceObjectId: string,
    inSliceIndex: number,
  ): string {
    const factItemCanonical = canonicalize(factItem as Parameters<typeof canonicalize>[0]);
    const digest = createHash('sha256')
      .update(factItemCanonical, 'utf8')
      .update(sliceObjectId, 'utf8')
      .update(String(inSliceIndex), 'utf8')
      .digest();
    const bytes = Buffer.alloc(16);
    bytes.writeUInt32BE(Math.floor(asOfMilliseconds / 0x10000), 0);
    bytes.writeUInt16BE(asOfMilliseconds % 0x10000, 4);
    bytes[6] = 0x70 | ((digest[0] ?? 0) & 0x0f);
    bytes[7] = digest[1] ?? 0;
    bytes[8] = 0x80 | ((digest[2] ?? 0) & 0x3f);
    digest.copy(bytes, 9, 3, 10);
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function sliceOrderTuple(ref: Common.ContentAddressedRef): string[] {
    const hash = record(ref.contentHash);
    const source = ref as unknown as Record<string, unknown>;
    return [
      ref.objectType,
      ref.objectId,
      (source.immutableVersionId as string | undefined) ?? '',
      hash.algorithm as string,
      hash.canonicalizationVersion as string,
      hash.digest as string,
      canonicalize(ref.scope as Parameters<typeof canonicalize>[0]),
    ];
  }

  function compareOrderTuples(left: readonly string[], right: readonly string[]): number {
    const width = Math.min(left.length, right.length);
    for (let index = 0; index < width; index += 1) {
      const a = left[index] ?? '';
      const b = right[index] ?? '';
      if (a < b) return -1;
      if (a > b) return 1;
    }
    return left.length - right.length;
  }

  async function readyTaskForValidation(
    taskId: string,
    completionConfig?: FormalCompletionEntryConfig,
    afterBuild?: () => Promise<void>,
    expectBuildUnavailable = false,
  ) {
    const taskCodeSuffix = taskId.replaceAll('-', '');
    const capabilityCodes = {
      taskReadinessBuildV1: `wi219.task.readiness.${taskCodeSuffix}`,
      taskReadyV1: `wi219.task.ready.${taskCodeSuffix}`,
    };
    await grant({
      capabilityCode: capabilityCodes.taskReadinessBuildV1,
      action: 'execution.task.readiness.build',
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: 'zhiju.execution.task_readiness',
    });
    await grant({
      capabilityCode: capabilityCodes.taskReadyV1,
      action: 'execution.task.mark_ready',
      selectorType: 'TARGET_TYPE',
      targetObjectType: TASK_V2,
    });
    const policyRef = policyKey([newUuidV7(), newUuidV7()], fixture);
    await registerPolicyVersionAs({
      key: policyRef,
      factId: newUuidV7(),
      idempotencyKey: newUuidV7(),
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference('execution.task_readiness.policy@1.0')],
      policyDocument: { maxReadinessValiditySeconds: 600 },
    });
    const entry = createTaskReadinessEntry({
      ...(completionConfig ? { formalCompletion: completionConfig } : {}),
      taskExecutionDb: teDb,
      enterpriseProjectDb,
      identity: { db: identityDb, repo: identityRepo, crypto },
      capabilityCodes,
      capabilities: dependencyCapabilities,
      now: () => new Date(clock),
    });
    const auth = createTaskExecutionReadinessAuthorizationPort({
      capabilityCodes,
      now: () => new Date(clock),
    });
    const root = (
      await admin.query(
        'SELECT current_definition_snapshot_id, current_definition_hash FROM task_execution.task WHERE task_id=$1',
        [taskId],
      )
    ).rows[0] as { current_definition_snapshot_id: string; current_definition_hash: Buffer };
    const taskRef = objectRef(TASK_V2, taskId, scope());
    async function envelope(
      commandType: string,
      targetRef: Record<string, unknown>,
      payload: CanonicalJsonObject,
      expectedAggregateVersion?: number,
    ) {
      const payloadHash = digestCanonicalPayload(payload).hash;
      const issued = await auth.authorizeReadiness(identityDeps([fixture.projectId]), {
        actorSnapshotRef: operatorActorRef,
        commandType,
        commandVersion: '1.0',
        targetRef: targetRef as unknown as Common.ObjectRef,
        commandPayloadHash: payloadHash,
        authenticationContextHash: AUTH_HASH,
      });
      expect(issued.outcome).toBe('ALLOW');
      return {
        commandId: newUuidV7(),
        commandType,
        commandVersion: '1.0',
        scopeRef: scope(),
        targetRef,
        actor: operatorActorRef,
        authorizationDecisionRef: issued.authorizationDecisionRef,
        idempotencyKey: newUuidV7(),
        correlationId: newUuidV7(),
        requestedAt: new Date(clock).toISOString(),
        ...(expectedAggregateVersion === undefined ? {} : { expectedAggregateVersion }),
        payload,
        integrity: {
          canonicalizationVersion: '1',
          payloadHash: contentHash(payloadHash.toString('hex')),
        },
      };
    }
    const build = await entry.build(
      await envelope(
        'execution.build_task_readiness',
        objectRef('zhiju.execution.task_readiness', newUuidV7(), scope()),
        {
          taskRef,
          taskDefinitionRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'zhiju.execution.task_definition_snapshot',
            objectId: root.current_definition_snapshot_id,
            scope: scope(),
            contentHash: contentHash(root.current_definition_hash.toString('hex')),
          },
          policyRef,
          evaluatorRef: registeredEvaluatorProfileReference(
            'im06-evaluator-static-v1',
            'te.task_readiness.evaluator@1.0',
          ),
        } as unknown as CanonicalJsonObject,
      ),
      sessionFor(),
    );
    expect(build, JSON.stringify(build)).toMatchObject({ status: 'COMMITTED' });
    if (expectBuildUnavailable) {
      const snapshotRef = record(record(committedPayload(build)).data).readinessSnapshotRef;
      expect(
        (
          await admin.query(
            'SELECT ready FROM task_execution.execution_judgment WHERE judgment_id=$1',
            [record(snapshotRef).objectId],
          )
        ).rows,
      ).toEqual([{ ready: false }]);
      expect(
        (await admin.query('SELECT status FROM task_execution.task WHERE task_id=$1', [taskId]))
          .rows,
      ).toEqual([{ status: 'DRAFT' }]);
      return;
    }
    const readinessSnapshotRef = record(record(committedPayload(build)).data).readinessSnapshotRef;
    await afterBuild?.();
    const readyCommand = await envelope(
      'execution.mark_task_ready',
      taskRef,
      { readinessSnapshotRef, requestedAt: new Date(clock).toISOString() } as CanonicalJsonObject,
      1,
    );
    if (afterBuild) {
      const result = await Promise.allSettled([entry.markReady(readyCommand, sessionFor())]);
      const actual = definedValue(result[0]);
      if (actual.status === 'rejected')
        expect(actual.reason).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
      else
        expect(actual.value).toMatchObject({
          status: 'REJECTED',
          errorCode: 'EXECUTION_JUDGMENT_STALE',
        });
      expect(
        (await admin.query('SELECT status FROM task_execution.task WHERE task_id=$1', [taskId]))
          .rows,
      ).toEqual([{ status: 'DRAFT' }]);
    } else {
      const ready = await entry.markReady(readyCommand, sessionFor());
      expect(ready, JSON.stringify(ready)).toMatchObject({ status: 'COMMITTED' });
    }
  }

  async function deliveryTestEntries(taskId: string): Promise<{
    bindings: ReturnType<typeof taskCompletedDeliveryBindings>;
    roles: Record<'dispatcher' | 'consumer' | 'evaluator' | 'reader', Principal>;
    capabilityCodes: Record<string, string>;
    grants: Map<string, string>;
    authorization: Parameters<typeof createTaskCompletedDeliveryEntry>[0]['authorization'];
    config: Parameters<typeof createTaskCompletedDeliveryEntry>[0];
    entry: ReturnType<typeof createTaskCompletedDeliveryEntry>;
    second: ReturnType<typeof createTaskCompletedDeliveryEntry>;
    session: (principal: Principal) => DeliveryCompletionSession;
    projectRef: Common.ObjectRef;
  }> {
    const roles = {} as Record<'dispatcher' | 'consumer' | 'evaluator' | 'reader', Principal>;
    for (const role of ['dispatcher', 'consumer', 'evaluator', 'reader'] as const) {
      const id = newUuidV7(),
        actorId = newUuidV7(),
        authHash = Buffer.from(digestCanonicalPayload({ role, id }).hash);
      await withIdentityTransaction(identityDb, identityContext([fixture.projectId]), (trx) =>
        identityRepo.insertPrincipal(trx, {
          id,
          principalKind: 'SERVICE',
          displayName: `Delivery ${role}`,
          createdByPrincipalId: OPERATOR,
          createdByActorSnapshotId: OPERATOR_ACTOR,
        }),
      );
      const actorRef = await createActorSnapshot(identityDeps([fixture.projectId]), {
        actorSnapshotId: actorId,
        principalId: id,
        declaredPrincipalKind: 'SERVICE',
        authenticationContextHash: authHash,
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      });
      roles[role] = {
        principalId: id,
        principalKind: 'SERVICE',
        actorSnapshotId: actorId,
        actorRef,
        authHash,
      };
    }
    const bindings = taskCompletedDeliveryBindings(),
      capabilityCodes: Record<string, string> = {},
      grants = new Map<string, string>();
    for (const b of bindings) {
      const capabilityCode = `wi239.cap.${b.capabilityConfigKey.toLowerCase()}.${taskId.replace(/-/g, '')}`;
      capabilityCodes[b.capabilityConfigKey] = capabilityCode;
      const principal =
        b.expectedPrincipalKind === 'HUMAN'
          ? operator()
          : b.capabilityConfigKey.startsWith('taskCompleted')
            ? roles.dispatcher
            : b.capabilityConfigKey === 'deliveryCompletionConsumeV1'
              ? roles.consumer
              : b.capabilityConfigKey === 'deliveryItemCompletionEvaluateV2'
                ? roles.evaluator
                : roles.reader;
      grants.set(
        b.capabilityConfigKey,
        await grant({
          principal,
          capabilityCode,
          action: b.requiredGrantAction,
          selectorType: b.selectorType,
          targetObjectType: definedValue(b.targetObjectTypes[0]),
        }),
      );
    }
    const authorization = {
      capabilityCodes,
      servicePrincipalIds: Object.fromEntries(
        Object.entries(roles).map(([k, v]) => [k, v.principalId]),
      ) as Record<keyof typeof roles, string>,
      now: () => new Date(clock),
    };
    const config = {
      taskExecutionDb: teDb,
      enterpriseProjectDb,
      identity: { db: identityDb, repo: identityRepo, crypto },
      authorization,
      now: () => new Date(clock),
      workerInstanceId: 'worker_a',
    };
    const entry = createTaskCompletedDeliveryEntry(config),
      second = createTaskCompletedDeliveryEntry({ ...config, workerInstanceId: 'worker_b' });
    const session = (p: Principal): DeliveryCompletionSession => ({
      ...sessionFor(p),
      identityContext: identityContext([fixture.projectId], p),
    });
    const projectRef = objectRef(
      'zhiju.project.project',
      fixture.projectId,
      scope(),
    ) as Common.ObjectRef;
    return {
      bindings,
      roles,
      capabilityCodes,
      grants,
      authorization,
      config,
      entry,
      second,
      session,
      projectRef,
    };
  }

  async function verifyDeliveryTail(
    plan: Awaited<ReturnType<typeof createDeliveryCompletionPlanFixture>>,
    taskId: string,
    sourceService: Principal,
    requiresRelease: boolean,
  ) {
    phase('delivery completion owning tail');
    const {
      bindings,
      roles,
      capabilityCodes,
      grants,
      authorization,
      config,
      entry,
      second,
      session,
      projectRef,
    } = await deliveryTestEntries(taskId);
    const eventRow = definedValue(
      (
        await admin.query<{
          event_id: string;
          payload: CanonicalJsonObject;
          payload_hash: Buffer;
          causation_id: string | null;
          source_command_id: string;
        }>(
          "SELECT event_id,payload,payload_hash,causation_id,source_command_id FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.TaskCompleted'",
          [taskId],
        )
      ).rows[0],
    );
    const candidates = await entry.scan(projectRef, session(roles.dispatcher));
    expect(candidates).toContain(eventRow.event_id);
    await expect(entry.scan(projectRef, session(roles.consumer))).rejects.toMatchObject({
      code: 'AUTHORIZATION_DECISION_INVALID',
    });
    const cursorBeforeDeniedClaim = (
      await admin.query(
        'SELECT * FROM task_execution.task_completed_dispatch_cursor WHERE project_id=$1',
        [fixture.projectId],
      )
    ).rows;
    await expect(
      entry.scan(projectRef, {
        ...session(roles.dispatcher),
        resolutionActorSnapshotRef: { ...roles.dispatcher.actorRef, snapshotId: newUuidV7() },
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DECISION_INVALID' });
    await expect(
      entry.scan(projectRef, {
        ...session(roles.dispatcher),
        authenticationContextHash: Buffer.alloc(32, 9),
      }),
    ).rejects.toBeDefined();
    const missingRead = createTaskCompletedDeliveryEntry({
      ...config,
      authorization: {
        ...authorization,
        capabilityCodes: { ...capabilityCodes, taskCompletedReadV1: 'wi239.cap.missing_read' },
      },
    });
    await expect(
      missingRead.claim(projectRef, eventRow.event_id, session(roles.dispatcher)),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DECISION_INVALID' });
    expect(
      (
        await admin.query(
          'SELECT count(*)::int n FROM task_execution.task_completed_dispatch_binding WHERE event_id=$1',
          [eventRow.event_id],
        )
      ).rows,
    ).toEqual([{ n: 0 }]);
    expect(
      (
        await admin.query(
          'SELECT * FROM task_execution.task_completed_dispatch_cursor WHERE project_id=$1',
          [fixture.projectId],
        )
      ).rows,
    ).toEqual(cursorBeforeDeniedClaim);
    // Negative source corruption only: restore the bytes created by the real producer.
    await admin.query('UPDATE task_execution.outbox_event SET causation_id=$2 WHERE event_id=$1', [
      eventRow.event_id,
      newUuidV7(),
    ]);
    try {
      await expect(
        entry.claim(projectRef, eventRow.event_id, session(roles.dispatcher)),
      ).rejects.toThrow('DISPATCH_SOURCE_INVALID');
    } finally {
      await admin.query(
        'UPDATE task_execution.outbox_event SET causation_id=$2 WHERE event_id=$1',
        [eventRow.event_id, eventRow.causation_id],
      );
    }
    for (const statement of [
      'SELECT * FROM task_execution.outbox_event',
      'SELECT * FROM task_execution.task',
      'SELECT * FROM enterprise_project.delivery_item_completion_fact',
      `SELECT task_execution.dispatch_scan('${fixture.enterpriseId}'::uuid,'${fixture.projectId}'::uuid)`,
    ]) {
      await admin.query('BEGIN');
      try {
        await admin.query('SET LOCAL ROLE task_execution_dispatcher');
        await expect(
          admin.query(statement),
          'IP-DEL-D-005 dispatcher ACL/no Context',
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await admin.query('ROLLBACK');
      }
    }
    const unavailableIpPool = new pg.Pool({
      connectionString: 'postgres://invalid:invalid@127.0.0.1:1/unavailable',
      connectionTimeoutMillis: 500,
    });
    try {
      const unavailableIp = createTaskCompletedDeliveryEntry({
        ...config,
        identity: { ...config.identity, db: createIdentityPolicyDatabase(unavailableIpPool) },
      });
      await expect(unavailableIp.scan(projectRef, session(roles.dispatcher))).rejects.toBeDefined();
      expect(
        (
          await admin.query(
            'SELECT count(*)::int n FROM task_execution.task_completed_dispatch_binding WHERE event_id=$1',
            [eventRow.event_id],
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
    } finally {
      await unavailableIpPool.end();
    }
    if (!requiresRelease) {
      const blocker = new pg.Client({ connectionString: activeDatabaseUrl });
      await blocker.connect();
      let waitingClaim:
        Promise<PromiseSettledResult<Awaited<ReturnType<typeof entry.claim>>>> | undefined;
      try {
        await blocker.query('BEGIN');
        const pid = definedValue(
          (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0],
        ).pid;
        await blocker.query(
          'SELECT event_id FROM task_execution.outbox_event WHERE event_id=$1 FOR UPDATE',
          [eventRow.event_id],
        );
        waitingClaim = Promise.allSettled([
          entry.claim(projectRef, eventRow.event_id, session(roles.dispatcher)),
        ]).then((results) => definedValue(results[0]));
        const until = Date.now() + 15000;
        let blocked = false;
        while (Date.now() < until) {
          blocked =
            definedValue(
              (
                await admin.query<{ n: number }>(
                  'SELECT count(*)::int n FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',
                  [pid],
                )
              ).rows[0],
            ).n > 0;
          if (blocked) break;
          await waitForDeadline(25, 'claim row-lock coordination');
        }
        expect(blocked).toBe(true);
        expect(
          await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
            targetId: definedValue(grants.get('taskCompletedClaimV1')),
            expectedAggregateVersion: '1',
            scope: {
              scopeKind: 'PROJECT',
              enterpriseId: fixture.enterpriseId,
              projectId: fixture.projectId,
            },
            reasonCode: 'REVOKED_WHILE_CLAIM_WAITING',
            effectiveAt: new Date(clock),
            idempotencyKey: newUuidV7(),
          }),
        ).toMatchObject({ status: 'COMMITTED' });
      } finally {
        await blocker.query('ROLLBACK');
        await blocker.end();
      }
      const denied = await definedValue(waitingClaim);
      expect(denied).toMatchObject({
        status: 'rejected',
        reason: { code: 'AUTHORIZATION_DECISION_INVALID' },
      });
      expect(
        (
          await admin.query(
            'SELECT count(*)::int n FROM task_execution.task_completed_dispatch_binding WHERE event_id=$1',
            [eventRow.event_id],
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
      const binding = definedValue(
        bindings.find((b) => b.capabilityConfigKey === 'taskCompletedClaimV1'),
      );
      grants.set(
        binding.capabilityConfigKey,
        await grant({
          principal: roles.dispatcher,
          capabilityCode: definedValue(capabilityCodes[binding.capabilityConfigKey]),
          action: binding.requiredGrantAction,
          selectorType: binding.selectorType,
          targetObjectType: definedValue(binding.targetObjectTypes[0]),
        }),
      );
    }
    const claims = await Promise.all([
      entry.claim(projectRef, eventRow.event_id, session(roles.dispatcher)),
      second.claim(projectRef, eventRow.event_id, session(roles.dispatcher)),
    ]);
    expect(claims.map((claim) => claim.status).sort()).toEqual(['CLAIMED', 'UNAVAILABLE']);
    const claimOwner = claims[0].status === 'CLAIMED' ? entry : second;
    const retryOwner = claims[0].status === 'CLAIMED' ? second : entry;
    const claimed = definedValue(claims.find((claim) => claim.status === 'CLAIMED'));
    const material = await claimOwner.readClaimed(claimed, session(roles.dispatcher));
    expect(material.event.causationId).toBe(eventRow.causation_id ?? eventRow.source_command_id);
    expect(eventRow.causation_id === null).toBe(!requiresRelease);
    expect(record(material.sidecar.taskDefinitionSnapshotRef).kind).toBe('CONTENT_ADDRESSED');
    expect(record(material.sidecar.storedPayloadHash).digest).toBe(
      eventRow.payload_hash.toString('hex'),
    );
    expect(record(record(material.event.integrity).payloadHash).digest).toBe(
      digestCanonicalPayload(record(material.event.payload) as CanonicalJsonObject).hash.toString(
        'hex',
      ),
    );
    expect(record(material.sidecar.eventEnvelopeHash).digest).toBe(
      digestCanonicalPayload(material.event).hash.toString('hex'),
    );
    await expect(
      entry.consume(structuredClone(material), session(roles.consumer)),
    ).rejects.toMatchObject({ code: 'PROJECT_DELIVERY_COMPLETION_EVENT_INVALID' });
    if (!requiresRelease) {
      for (const [table, condition] of [
        ['inbox_message', `NEW.event_id='${eventRow.event_id}'::uuid`],
        ['delivery_item_completion_fact', `NEW.event_id='${eventRow.event_id}'::uuid`],
        ['delivery_completion_task_association', `NEW.event_id='${eventRow.event_id}'::uuid`],
        ['process_instance', `NEW.correlation_key='${eventRow.event_id}'`],
        ['process_step', `NEW.input_event_id='${eventRow.event_id}'::uuid`],
        ['audit_record', `NEW.target_id='${plan.deliveryItemRef.objectId}'::uuid`],
      ]) {
        await admin.query(
          "CREATE FUNCTION enterprise_project.wi239_consume_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'wi239 consumer atomic fault' USING ERRCODE='P0001'; END $f$",
        );
        await admin.query(
          `CREATE TRIGGER zz_wi239_fault AFTER INSERT ON enterprise_project.${table} FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION enterprise_project.wi239_consume_fault()`,
        );
        try {
          await expect(
            entry.consume(material, session(roles.consumer)),
            `TE-DEL-D-006 ${table}`,
          ).rejects.toMatchObject({ code: 'P0001' });
        } finally {
          await admin.query(`DROP TRIGGER zz_wi239_fault ON enterprise_project.${table}`);
          await admin.query('DROP FUNCTION enterprise_project.wi239_consume_fault()');
        }
        expect(
          (
            await admin.query(
              'SELECT count(*)::int n FROM enterprise_project.delivery_item_completion_fact WHERE event_id=$1',
              [eventRow.event_id],
            )
          ).rows,
        ).toEqual([{ n: 0 }]);
        expect(
          (
            await admin.query(
              'SELECT count(*)::int n FROM enterprise_project.inbox_message WHERE event_id=$1',
              [eventRow.event_id],
            )
          ).rows,
        ).toEqual([{ n: 0 }]);
        expect(
          (
            await admin.query(
              'SELECT count(*)::int n FROM enterprise_project.delivery_completion_task_association WHERE event_id=$1',
              [eventRow.event_id],
            )
          ).rows,
        ).toEqual([{ n: 0 }]);
        expect(
          (
            await admin.query(
              'SELECT count(*)::int n FROM enterprise_project.process_instance WHERE correlation_key=$1',
              [eventRow.event_id],
            )
          ).rows,
        ).toEqual([{ n: 0 }]);
      }
    }
    const consumed = await Promise.all([
      entry.consume(material, session(roles.consumer)),
      entry.consume(material, session(roles.consumer)),
    ]);
    expect(consumed.map((r) => r.status).sort()).toEqual(['DUPLICATE', 'PROCESSED']);
    const receipt = definedValue(consumed.find((r) => r.status === 'PROCESSED'));
    if (!('factRef' in receipt)) throw new Error('Missing owning fact');
    expect(Object.isFrozen(receipt.factRef)).toBe(true);
    expect(Object.isFrozen(receipt.factRef.contentHash)).toBe(true);
    expect(Object.isFrozen(receipt.factRef.scope)).toBe(true);
    expect(() => Object.assign(receipt.factRef, { objectId: newUuidV7() })).toThrow(TypeError);
    await expect(
      claimOwner.confirm(
        claimed,
        material,
        structuredClone(receipt) as unknown as CanonicalJsonObject,
        session(roles.dispatcher),
      ),
    ).rejects.toMatchObject({ code: 'DISPATCH_ACK_INVALID' });
    const request = {
      deliveryPlanRef: plan.deliveryPlanRef,
      deliveryItemRef: plan.deliveryItemRef,
      factRefs: [receipt.factRef],
    };
    expect(await entry.readExact(request, session(roles.reader))).toMatchObject({
      derivedStatus: 'NOT_EVALUATED',
      completionAggregateVersion: 1,
      taskFactSemantics: 'HISTORICAL_COMPLETION',
      taskCurrentUseStatus: 'UNKNOWN',
    });
    for (const table of [
      'task_execution.task_completed_dispatch_binding',
      'task_execution.task_completed_dispatch_attempt',
      'enterprise_project.delivery_completion_task_association',
    ]) {
      await expect(
        admin.query(`UPDATE ${table} SET event_id=event_id WHERE event_id=$1`, [eventRow.event_id]),
        'immutable owning history',
      ).rejects.toMatchObject({ code: '55000' });
      await expect(
        admin.query(`DELETE FROM ${table} WHERE event_id=$1`, [eventRow.event_id]),
        'immutable owning history',
      ).rejects.toMatchObject({ code: '55000' });
    }
    const { handleEvaluateDeliveryItemCompletion } = await import('@zhiju/enterprise-project');
    const legacyPayload = {
      input: {
        deliveryPlanRef: { ...plan.deliveryPlanRef, objectType: 'DeliveryPlan' },
        deliveryItemId: plan.deliveryItemRef.objectId,
        criteriaHash: contentHash(
          digestCanonicalPayload({ criteria: plan.completionCriteria }).hash.toString('hex'),
        ),
        factRefs: [receipt.factRef],
        sourceWatermarks: [material.sourceWatermark],
        evaluatorRef: {
          kind: 'VERSIONED',
          objectType: 'zhiju.quality.evaluator',
          objectId: newUuidV7(),
          versionId: newUuidV7(),
          scope: scope(),
        },
        evaluatedAt: new Date(clock).toISOString(),
      },
    };
    const legacyCapability = `wi239.legacy.${taskId.replaceAll('-', '')}`;
    await grantGeneric(legacyCapability);
    const legacyDecision = await authorizeCommandTracked(identityDeps([fixture.projectId]), {
      actorSnapshotRef: operatorActorRef,
      intent: {
        commandType: 'project.evaluate_delivery_item_completion',
        commandVersion: '1.0',
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
        purpose: 'project.evaluate_delivery_item_completion',
        requestedCapability: legacyCapability,
        commandPayloadHash: digestCanonicalPayload(legacyPayload as unknown as CanonicalJsonObject)
          .hash,
        requestedAt: new Date(clock),
        highRiskAction: false,
      },
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: grantPolicySnapshotReference(),
      ttlSeconds: 900,
    });
    expect(legacyDecision.outcome).toBe('ALLOW');
    const legacyContext = {
      ...runnerContext(),
      authorizationDecisionId: legacyDecision.authorizationDecisionRef.objectId,
      authorizationDecisionHash: Buffer.from(
        legacyDecision.authorizationDecisionRef.contentHash.digest,
        'hex',
      ),
      authorizationDecisionExpiresAt: new Date(legacyDecision.expiresAt),
    };
    await expect(
      handleEvaluateDeliveryItemCompletion(enterpriseProjectDb, legacyContext, {
        commandId: newUuidV7(),
        commandType: 'project.evaluate_delivery_item_completion',
        commandVersion: '1.0',
        idempotencyScope: `wi239:legacy:${taskId}`,
        idempotencyKey: newUuidV7(),
        requestPayload: legacyPayload as unknown as CanonicalJsonObject,
        payload:
          legacyPayload as unknown as EnterpriseProject.ProjectEvaluateDeliveryItemCompletionPayload,
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
        targetType: 'DeliveryItem',
        targetId: plan.deliveryItemRef.objectId,
        expectedAggregateVersion: '1',
        correlationId: legacyContext.correlationId,
        principalId: OPERATOR,
        principalKind: 'HUMAN',
        actorSnapshotId: OPERATOR_ACTOR,
        authorizationDecisionId: legacyContext.authorizationDecisionId,
        policySnapshotId: legacyContext.policySnapshotId,
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED' });
    for (const field of ['objectId', 'versionId'] as const) {
      const wrong = structuredClone(request);
      wrong.deliveryItemRef = { ...wrong.deliveryItemRef, [field]: newUuidV7() };
      await expect(entry.readExact(wrong, session(roles.reader))).rejects.toMatchObject({
        code:
          field === 'versionId'
            ? 'PROJECT_DELIVERY_REFERENCE_INVALID'
            : 'PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND',
      });
    }
    if (requiresRelease) {
      const otherFact = definedValue(
        (
          await admin.query<{ fact_ref: Common.ContentAddressedRef }>(
            "SELECT fact_ref FROM enterprise_project.delivery_item_completion_fact WHERE project_id=$1 AND event_id<>$2 AND event_type='execution.TaskCompleted' ORDER BY recorded_at LIMIT 1",
            [fixture.projectId, eventRow.event_id],
          )
        ).rows[0],
      ).fact_ref;
      await expect(
        entry.readExact({ ...request, factRefs: [otherFact] }, session(roles.reader)),
      ).rejects.toMatchObject({ code: 'PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND' });
      await expect(
        entry.evaluate(
          {
            payload: { ...request, factRefs: [otherFact] },
            expectedAggregateVersion: 1,
            idempotencyKey: newUuidV7(),
          },
          session(roles.evaluator),
        ),
      ).rejects.toMatchObject({ code: 'PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND' });
      expect(
        (
          await admin.query(
            'SELECT count(*)::int n FROM enterprise_project.delivery_item_completion_evaluation WHERE delivery_item_id=$1',
            [plan.deliveryItemRef.objectId],
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
      expect(
        (
          await admin.query(
            'SELECT count(*)::int n FROM enterprise_project.delivery_item_completion_fact WHERE fact_id=$1',
            [otherFact.objectId],
          )
        ).rows,
      ).toEqual([{ n: 1 }]);
    }
    // Commit-before-confirm transport loss: original materials are delivered again.
    expect(
      await claimOwner.markFailure(
        claimed,
        'DISPATCH_TRANSPORT_UNKNOWN',
        session(roles.dispatcher),
      ),
    ).toBe('UNKNOWN');
    await waitForDeadline(2100, 'bounded delivery retry backoff');
    clock = Date.now();
    let reclaimed = await retryOwner.claim(
      projectRef,
      eventRow.event_id,
      session(roles.dispatcher),
    );
    if (reclaimed.status !== 'CLAIMED') throw new Error(JSON.stringify(reclaimed));
    expect(BigInt(reclaimed.leaseToken)).toBeGreaterThan(BigInt(claimed.leaseToken));
    let replay = await retryOwner.readClaimed(reclaimed, session(roles.dispatcher));
    expect(replay).toEqual(material);
    const duplicate = await retryOwner.consume(replay, session(roles.consumer));
    expect(duplicate).toMatchObject({ status: 'DUPLICATE', factRef: receipt.factRef });
    await expect(
      claimOwner.confirm(
        claimed,
        material,
        receipt as unknown as CanonicalJsonObject,
        session(roles.dispatcher),
      ),
    ).rejects.toThrow('DISPATCHER_STALE_LEASE');
    await expect(
      claimOwner.markFailure(claimed, 'DISPATCH_TIMEOUT', session(roles.dispatcher)),
    ).rejects.toThrow('DISPATCHER_STALE_LEASE');
    if (!requiresRelease) {
      for (let attempt = 2; attempt <= 5; attempt++) {
        expect(
          await retryOwner.markFailure(reclaimed, 'DISPATCH_TIMEOUT', session(roles.dispatcher)),
        ).toBe(attempt === 5 ? 'DEAD' : 'UNKNOWN');
        if (attempt < 5) {
          await waitForDeadline(2 ** attempt * 1000 + 100, 'finite automatic delivery retry');
          clock = Date.now();
          const next = await retryOwner.claim(
            projectRef,
            eventRow.event_id,
            session(roles.dispatcher),
          );
          if (next.status !== 'CLAIMED') throw new Error(JSON.stringify(next));
          expect(BigInt(next.leaseToken)).toBeGreaterThan(BigInt(reclaimed.leaseToken));
          reclaimed = next;
          expect(await retryOwner.readClaimed(reclaimed, session(roles.dispatcher))).toEqual(
            material,
          );
        }
      }
      expect(
        await retryOwner.claim(projectRef, eventRow.event_id, session(roles.dispatcher)),
      ).toMatchObject({ status: 'UNAVAILABLE' });
      await expect(
        retryOwner.resumeDead(
          claimed.taskRef as unknown as Common.ObjectRef,
          eventRow.event_id,
          'Approved retry window',
          session(roles.dispatcher),
        ),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_DECISION_INVALID' });
      await admin.query(
        "CREATE FUNCTION task_execution.wi239_resume_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'wi239 resume atomic fault' USING ERRCODE='P0001'; END $f$",
      );
      await admin.query(
        `CREATE TRIGGER zz_wi239_resume_fault AFTER INSERT ON task_execution.audit_record FOR EACH ROW WHEN (NEW.command_type='execution.task_completed.dispatch.resume') EXECUTE FUNCTION task_execution.wi239_resume_fault()`,
      );
      try {
        await expect(
          retryOwner.resumeDead(
            claimed.taskRef as unknown as Common.ObjectRef,
            eventRow.event_id,
            'Approved retry window',
            session(operator()),
          ),
        ).rejects.toMatchObject({ code: 'P0001' });
      } finally {
        await admin.query('DROP TRIGGER zz_wi239_resume_fault ON task_execution.audit_record');
        await admin.query('DROP FUNCTION task_execution.wi239_resume_fault()');
      }
      expect(
        (
          await admin.query(
            'SELECT delivery_state,attempt_count,lease_token FROM task_execution.outbox_event WHERE event_id=$1',
            [eventRow.event_id],
          )
        ).rows,
      ).toEqual([{ delivery_state: 'DEAD', attempt_count: 5, lease_token: '5' }]);
      await retryOwner.resumeDead(
        claimed.taskRef as unknown as Common.ObjectRef,
        eventRow.event_id,
        'Approved retry window',
        session(operator()),
      );
      const expiring = createTaskCompletedDeliveryEntry({
        ...config,
        workerInstanceId: 'expiry_worker',
        leaseSeconds: 1,
      });
      const resumed = await expiring.claim(
        projectRef,
        eventRow.event_id,
        session(roles.dispatcher),
      );
      if (resumed.status !== 'CLAIMED') throw new Error(JSON.stringify(resumed));
      expect(resumed.leaseToken).toBe('6');
      expect(await expiring.readClaimed(resumed, session(roles.dispatcher))).toEqual(material);
      await waitForDeadline(1100, 'actual finite delivery lease expiry');
      clock = Date.now();
      await expect(
        expiring.markFailure(resumed, 'DISPATCH_TIMEOUT', session(roles.dispatcher)),
      ).rejects.toThrow('DISPATCHER_STALE_LEASE');
      const takeover = await retryOwner.claim(
        projectRef,
        eventRow.event_id,
        session(roles.dispatcher),
      );
      if (takeover.status !== 'CLAIMED') throw new Error(JSON.stringify(takeover));
      expect(takeover.leaseToken).toBe('7');
      reclaimed = takeover;
      replay = await retryOwner.readClaimed(reclaimed, session(roles.dispatcher));
      expect(replay).toEqual(material);
    }
    await retryOwner.confirm(
      reclaimed,
      replay,
      duplicate as unknown as CanonicalJsonObject,
      session(roles.dispatcher),
    );
    let evaluationInput = {
      payload: request,
      expectedAggregateVersion: 1,
      idempotencyKey: newUuidV7(),
    };
    if (!requiresRelease) {
      for (const [table, timing, event, condition] of [
        [
          'delivery_item_completion_evaluation',
          'AFTER',
          'INSERT',
          `NEW.delivery_item_id='${plan.deliveryItemRef.objectId}'::uuid`,
        ],
        [
          'delivery_item',
          'AFTER',
          'UPDATE',
          `NEW.delivery_item_id='${plan.deliveryItemRef.objectId}'::uuid AND NEW.current_completion_evaluation_id IS NOT NULL`,
        ],
        [
          'outbox_event',
          'AFTER',
          'INSERT',
          `NEW.aggregate_id='${plan.deliveryItemRef.objectId}'::uuid AND NEW.event_type='project.DeliveryItemCompletionSatisfied'`,
        ],
        [
          'command_receipt',
          'AFTER',
          'UPDATE',
          `NEW.target_id='${plan.deliveryItemRef.objectId}'::uuid AND NEW.outcome='COMMITTED'`,
        ],
        [
          'audit_record',
          'AFTER',
          'INSERT',
          `NEW.target_id='${plan.deliveryItemRef.objectId}'::uuid AND NEW.outcome='COMMITTED'`,
        ],
      ]) {
        await admin.query(
          "CREATE FUNCTION enterprise_project.wi239_evaluate_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'wi239 evaluation atomic fault' USING ERRCODE='P0001'; END $f$",
        );
        await admin.query(
          `CREATE TRIGGER zz_wi239_fault ${timing} ${event} ON enterprise_project.${table} FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION enterprise_project.wi239_evaluate_fault()`,
        );
        try {
          await expect(
            entry.evaluate(evaluationInput, session(roles.evaluator)),
            `EP-DEL-D-005 ${table}`,
          ).rejects.toMatchObject({ code: 'P0001' });
        } finally {
          await admin.query(`DROP TRIGGER zz_wi239_fault ON enterprise_project.${table}`);
          await admin.query('DROP FUNCTION enterprise_project.wi239_evaluate_fault()');
        }
        expect(
          (
            await admin.query(
              'SELECT count(*)::int n FROM enterprise_project.delivery_item_completion_evaluation WHERE delivery_item_id=$1',
              [plan.deliveryItemRef.objectId],
            )
          ).rows,
        ).toEqual([{ n: 0 }]);
        expect(await entry.readExact(request, session(roles.reader))).toMatchObject({
          derivedStatus: 'NOT_EVALUATED',
          completionAggregateVersion: 1,
        });
        expect(
          (
            await admin.query(
              'SELECT count(*)::int n FROM enterprise_project.delivery_completion_task_association WHERE event_id=$1',
              [eventRow.event_id],
            )
          ).rows,
        ).toEqual([{ n: 1 }]);
      }
    }
    const contenderInput = { ...evaluationInput, idempotencyKey: newUuidV7() };
    const evaluationRace = await Promise.all([
      entry.evaluate(evaluationInput, session(roles.evaluator)),
      entry.evaluate(contenderInput, session(roles.evaluator)),
    ]);
    expect(evaluationRace.map((result) => result.status).sort()).toEqual(['COMMITTED', 'REJECTED']);
    const evaluation = definedValue(evaluationRace.find((result) => result.status === 'COMMITTED'));
    if (evaluationRace[0].status !== 'COMMITTED') evaluationInput = contenderInput;
    expect(evaluation).toMatchObject({
      status: 'COMMITTED',
      resultPayload: {
        outcome: requiresRelease ? 'UNSATISFIED' : 'SATISFIED',
        aggregateVersion: 2,
        ...(requiresRelease ? { satisfiedFactRefs: [] } : { satisfiedFactRefs: [receipt.factRef] }),
      },
    });
    expect(await entry.evaluate(evaluationInput, session(roles.evaluator))).toMatchObject({
      status: 'DUPLICATE',
      resultPayload: committedPayload(evaluation),
    });
    const differentHash = structuredClone(evaluationInput);
    differentHash.payload.factRefs[0] = {
      ...receipt.factRef,
      contentHash: contentHash('e'.repeat(64)),
    };
    await expect(entry.evaluate(differentHash, session(roles.evaluator))).rejects.toMatchObject({
      code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
    });
    const sameFingerprint = await entry.evaluate(
      { ...evaluationInput, expectedAggregateVersion: 2, idempotencyKey: newUuidV7() },
      session(roles.evaluator),
    );
    expect(sameFingerprint).toMatchObject({
      status: 'COMMITTED',
      resultPayload: committedPayload(evaluation),
    });
    const readback = await entry.readExact(
      {
        ...request,
        evaluationRef: committedPayload(evaluation)
          .evaluationRef as unknown as Common.ContentAddressedRef,
      },
      session(roles.reader),
    );
    expect(readback).toMatchObject({
      deliveryPlanRef: plan.deliveryPlanRef,
      deliveryItemRef: plan.deliveryItemRef,
      derivedStatus: requiresRelease ? 'UNSATISFIED' : 'SATISFIED',
      selectedEvaluationIsCurrent: true,
      completionAggregateVersion: 2,
    });
    expect(readback.facts[0]).toMatchObject({
      factRef: receipt.factRef,
      taskRef: claimed.taskRef,
      deliveryPlanRef: plan.deliveryPlanRef,
      deliveryItemRef: plan.deliveryItemRef,
      bindingHash: material.bindingHash,
    });
    const storedEval = definedValue(
      (
        await admin.query<{ payload: CanonicalJsonObject; payload_hash: Buffer }>(
          'SELECT payload,payload_hash FROM enterprise_project.delivery_item_completion_evaluation WHERE delivery_item_id=$1',
          [plan.deliveryItemRef.objectId],
        )
      ).rows[0],
    );
    expect(storedEval.payload_hash.toString('hex')).toBe(
      digestCanonicalPayload(storedEval.payload).hash.toString('hex'),
    );
    // Negative SQL control: keep the legitimate owning row and every mirror,
    // omit only the discriminator, and recompute its derived hashes. A missing
    // discriminator must never turn an exact-profile Item into a legacy Item.
    const evaluationId = record(committedPayload(evaluation).evaluationRef).objectId as string;
    const pointerBefore = (
      await admin.query(
        'SELECT current_completion_evaluation_id,completion_aggregate_version FROM enterprise_project.delivery_item WHERE version_id=$1 AND delivery_item_id=$2',
        [plan.deliveryItemRef.versionId, plan.deliveryItemRef.objectId],
      )
    ).rows;
    await expect(
      withEnterpriseProjectTransaction(
        enterpriseProjectDb,
        runnerContext(roles.evaluator),
        async (trx) => {
          const role = await sql<{ role: string; allowed: boolean }>`
            SELECT current_user AS role,
              platform_security.context_allows_project(${fixture.enterpriseId}::uuid,${fixture.projectId}::uuid) AS allowed
          `.execute(trx);
          expect(role.rows).toEqual([{ role: 'enterprise_project_app', allowed: true }]);
          await sql`
            INSERT INTO enterprise_project.delivery_item_completion_evaluation (
              evaluation_id,delivery_plan_id,version_id,delivery_item_id,enterprise_id,project_id,
              criteria_hash,evaluator_ref,evaluator_ref_hash,evaluator_id,evaluator_version_id,
              fact_refs,fact_refs_hash,source_watermarks,source_watermarks_hash,outcome,
              payload,payload_hash,input_fingerprint,evaluated_at,recorded_by_principal_id,
              recorded_by_actor_snapshot_id,authorization_decision_id,source_command_id,source_event_id
            ) SELECT ${newUuidV7()}::uuid,delivery_plan_id,version_id,delivery_item_id,enterprise_id,project_id,
              criteria_hash,evaluator_ref,evaluator_ref_hash,evaluator_id,evaluator_version_id,
              fact_refs,fact_refs_hash,source_watermarks,source_watermarks_hash,outcome,
              payload-'taskFactSemantics',enterprise_project.completion_hash(payload-'taskFactSemantics'),
              enterprise_project.completion_hash(payload-'taskFactSemantics'-'outcome'-'satisfiedFactRefs'-'evaluatedAt'),
              evaluated_at,recorded_by_principal_id,recorded_by_actor_snapshot_id,authorization_decision_id,
              source_command_id,source_event_id
            FROM enterprise_project.delivery_item_completion_evaluation WHERE evaluation_id=${evaluationId}::uuid
          `.execute(trx);
          // Roll back even if the regression is present, so the counterexample
          // cannot contaminate the following owning readback assertions.
          throw Object.assign(new Error('Exact-profile guard was bypassed'), {
            code: 'WI239_GUARD_BYPASSED',
          });
        },
      ),
    ).rejects.toMatchObject({ code: '23514' });
    expect(
      (
        await admin.query(
          'SELECT current_completion_evaluation_id,completion_aggregate_version FROM enterprise_project.delivery_item WHERE version_id=$1 AND delivery_item_id=$2',
          [plan.deliveryItemRef.versionId, plan.deliveryItemRef.objectId],
        )
      ).rows,
    ).toEqual(pointerBefore);
    expect(record(record(readback.evaluation?.evaluationRef).contentHash).digest).toBe(
      storedEval.payload_hash.toString('hex'),
    );
    expect(
      (
        await admin.query(
          'SELECT count(*)::int n FROM enterprise_project.delivery_item_completion_fact WHERE event_id=$1',
          [eventRow.event_id],
        )
      ).rows,
    ).toEqual([{ n: 1 }]);
    expect(
      (
        await admin.query(
          'SELECT count(*)::int n FROM enterprise_project.delivery_completion_task_association WHERE event_id=$1',
          [eventRow.event_id],
        )
      ).rows,
    ).toEqual([{ n: 1 }]);
    expect(
      (
        await admin.query(
          'SELECT count(*)::int n FROM enterprise_project.process_instance WHERE correlation_key=$1',
          [eventRow.event_id],
        )
      ).rows,
    ).toEqual([{ n: 1 }]);
    expect(
      (
        await admin.query(
          'SELECT count(*)::int n FROM enterprise_project.delivery_item_completion_evaluation WHERE delivery_item_id=$1',
          [plan.deliveryItemRef.objectId],
        )
      ).rows,
    ).toEqual([{ n: 1 }]);
    expect(
      (
        await admin.query(
          "SELECT count(*)::int n FROM enterprise_project.outbox_event WHERE aggregate_id=$1 AND event_type='project.DeliveryItemCompletionSatisfied'",
          [plan.deliveryItemRef.objectId],
        )
      ).rows,
    ).toEqual([{ n: requiresRelease ? 0 : 1 }]);
    expect(
      (
        await admin.query(
          'SELECT delivery_state FROM task_execution.outbox_event WHERE event_id=$1',
          [eventRow.event_id],
        )
      ).rows,
    ).toEqual([{ delivery_state: 'PUBLISHED' }]);
    const epItemState = definedValue(
      (
        await admin.query<{ execution_status: string }>(
          'SELECT execution_status FROM enterprise_project.delivery_item WHERE version_id=$1 AND delivery_item_id=$2',
          [plan.deliveryItemRef.versionId, plan.deliveryItemRef.objectId],
        )
      ).rows[0],
    );
    expect(epItemState.execution_status).not.toBe('COMPLETED');
    await expect(entry.evaluate(evaluationInput, session(roles.consumer))).rejects.toMatchObject({
      code: 'AUTHORIZATION_DECISION_INVALID',
    });
    const broken = structuredClone(request);
    broken.factRefs[0] = {
      ...definedValue(broken.factRefs[0]),
      contentHash: { ...definedValue(broken.factRefs[0]).contentHash, digest: 'f'.repeat(64) },
    };
    await expect(entry.readExact(broken, session(roles.reader))).rejects.toMatchObject({
      code: 'PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND',
    });
    if (!requiresRelease) {
      // LOCAL SYNTHETIC ledger counterexample only. This is not an owning
      // Quality revocation producer or evidence of production revoke delivery.
      const revisionRef = definedValue(
        (material.event.payload as CanonicalJsonObject).satisfiedFactRefs as CanonicalJsonObject[],
      )[0];
      if (!revisionRef) throw new Error('Missing real output revision');
      const revocationId = newUuidV7(),
        correlationId = newUuidV7();
      const revocationPayload = {
        artifactRef: objectRef('artifact.artifact', newUuidV7(), scope()),
        revisionRef,
        priorApprovalBundleSnapshotRef: {
          kind: 'SNAPSHOT',
          objectType: 'quality.approval_bundle_snapshot',
          objectId: newUuidV7(),
          snapshotId: newUuidV7(),
          scope: scope(),
          contentHash: contentHash('a'.repeat(64)),
        },
        triggeringRef: revisionRef,
        reasonCode: 'LOCAL_SYNTHETIC_REVOCATION',
      } as unknown as CanonicalJsonObject;
      const revocationEvent = {
        eventId: revocationId,
        eventType: 'quality.RevisionApprovalLost',
        eventVersion: '1.0',
        producerModule: 'quality-governance',
        aggregateType: 'artifact.artifact_revision',
        aggregateId: revisionRef.objectId as string,
        aggregateVersion: 2,
        scopeRef: scope(),
        correlationId,
        causationId: newUuidV7(),
        commandId: newUuidV7(),
        actorRef: objectRef('identity.principal', roles.consumer.principalId, scope()),
        occurredAt: new Date(clock).toISOString(),
        dataClassification: 'INTERNAL',
        payload: revocationPayload,
        integrity: {
          canonicalizationVersion: '1',
          payloadHash: contentHash(digestCanonicalPayload(revocationPayload).hash.toString('hex')),
        },
      };
      const syntheticContext = {
        ...runnerContext(roles.consumer),
        kind: 'EVENT_CONSUMER' as const,
        sourceEventId: revocationId,
        correlationId,
      };
      expect(
        await consumeDeliveryItemCompletionEvent(enterpriseProjectDb, syntheticContext, {
          event: revocationEvent,
          sourceWatermark: {
            sourceModule: 'quality_governance',
            partition: fixture.projectId,
            sequence: 1,
            observedAt: new Date(clock).toISOString(),
          },
        }),
      ).toMatchObject({ status: 'PROCESSED' });
      const historicalRef = committedPayload(evaluation)
        .evaluationRef as unknown as Common.ContentAddressedRef;
      expect(
        await entry.readExact({ ...request, evaluationRef: historicalRef }, session(roles.reader)),
      ).toMatchObject({
        derivedStatus: 'UNSATISFIED',
        completionAggregateVersion: 2,
        evaluation: { outcome: 'SATISFIED' },
        selectedEvaluationIsCurrent: true,
      });
      const reevaluated = await entry.evaluate(
        { ...evaluationInput, expectedAggregateVersion: 2, idempotencyKey: newUuidV7() },
        session(roles.evaluator),
      );
      expect(reevaluated).toMatchObject({
        status: 'COMMITTED',
        resultPayload: { outcome: 'UNSATISFIED', aggregateVersion: 3, satisfiedFactRefs: [] },
      });
      expect(committedPayload(reevaluated).evaluationRef).not.toEqual(historicalRef);
      expect(await entry.evaluate(evaluationInput, session(roles.evaluator))).toMatchObject({
        status: 'DUPLICATE',
        resultPayload: committedPayload(evaluation),
      });
      expect(
        await entry.readExact({ ...request, evaluationRef: historicalRef }, session(roles.reader)),
      ).toMatchObject({
        derivedStatus: 'UNSATISFIED',
        completionAggregateVersion: 3,
        evaluation: { outcome: 'SATISFIED' },
        selectedEvaluationIsCurrent: false,
        taskFactSemantics: 'HISTORICAL_COMPLETION',
        taskCurrentUseStatus: 'UNKNOWN',
      });
    }
    for (const key of [
      'deliveryCompletionConsumeV1',
      'deliveryItemCompletionEvaluateV2',
      'deliveryCompletionReadExactV1',
    ]) {
      expect(
        await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
          targetId: definedValue(grants.get(key)),
          expectedAggregateVersion: '1',
          scope: {
            scopeKind: 'PROJECT',
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.projectId,
          },
          reasonCode: 'DELIVERY_CURRENT_AUTHORITY_REVOKED',
          effectiveAt: new Date(clock),
          idempotencyKey: newUuidV7(),
        }),
      ).toMatchObject({ status: 'COMMITTED' });
    }
    await expect(entry.consume(material, session(roles.consumer))).rejects.toMatchObject({
      code: 'AUTHORIZATION_DECISION_INVALID',
    });
    await expect(entry.evaluate(evaluationInput, session(roles.evaluator))).rejects.toMatchObject({
      code: 'AUTHORIZATION_DECISION_INVALID',
    });
    await expect(entry.readExact(request, session(roles.reader))).rejects.toMatchObject({
      code: 'AUTHORIZATION_DECISION_INVALID',
    });
    expect(sourceService.principalKind).toBe('SERVICE');
    // Positive evidence is always an owning read; SQL above only checks immutable bytes/counts.
  }
  return {
    runIntegrationCase,
    get itIntegration() {
      return itIntegration;
    },
    get createExecutableTask() {
      return createExecutableTask;
    },
    get createWorkOrder() {
      return createWorkOrder;
    },
    get attemptBuild() {
      return attemptBuild;
    },
    get preparedBuild() {
      return preparedBuild;
    },
    get expectNoContextSnapshot() {
      return expectNoContextSnapshot;
    },
    get draftSnapshotRefOf() {
      return draftSnapshotRefOf;
    },
    get appStatement() {
      return appStatement;
    },
    get track() {
      return track;
    },
    get admin() {
      return admin;
    },
    set admin(value: typeof admin) {
      admin = value;
    },
    get clock() {
      return clock;
    },
    set clock(value: typeof clock) {
      clock = value;
    },
    get entryFor() {
      return entryFor;
    },
    get sliceBRef() {
      return sliceBRef;
    },
    set sliceBRef(value: typeof sliceBRef) {
      sliceBRef = value;
    },
    get sliceARef() {
      return sliceARef;
    },
    set sliceARef(value: typeof sliceARef) {
      sliceARef = value;
    },
    get contextSnapshotRefOf() {
      return contextSnapshotRefOf;
    },
    get contextSnapshotRow() {
      return contextSnapshotRow;
    },
    get fixture() {
      return fixture;
    },
    set fixture(value: typeof fixture) {
      fixture = value;
    },
    get slicePayloadOf() {
      return slicePayloadOf;
    },
    get contextSnapshotBuildRow() {
      return contextSnapshotBuildRow;
    },
    get policyVersionRow() {
      return policyVersionRow;
    },
    get goldenDraftRef() {
      return goldenDraftRef;
    },
    set goldenDraftRef(value: typeof goldenDraftRef) {
      goldenDraftRef = value;
    },
    get compareOrderTuples() {
      return compareOrderTuples;
    },
    get sliceOrderTuple() {
      return sliceOrderTuple;
    },
    get receiptRows() {
      return receiptRows;
    },
    get auditRows() {
      return auditRows;
    },
    get edgeRows() {
      return edgeRows;
    },
    get outboxRows() {
      return outboxRows;
    },
    get draftPayloadOf() {
      return draftPayloadOf;
    },
    get goldenWorkOrderId() {
      return goldenWorkOrderId;
    },
    set goldenWorkOrderId(value: typeof goldenWorkOrderId) {
      goldenWorkOrderId = value;
    },
    get unitAssemblyInput() {
      return unitAssemblyInput;
    },
    get recomputeContextItemId() {
      return recomputeContextItemId;
    },
    get factA1() {
      return factA1;
    },
    set factA1(value: typeof factA1) {
      factA1 = value;
    },
    get factA2() {
      return factA2;
    },
    set factA2(value: typeof factA2) {
      factA2 = value;
    },
    get sliceCRef() {
      return sliceCRef;
    },
    set sliceCRef(value: typeof sliceCRef) {
      sliceCRef = value;
    },
    get initialContextEntry() {
      return initialContextEntry;
    },
    set initialContextEntry(value: typeof initialContextEntry) {
      initialContextEntry = value;
    },
    get sliceTTLRef() {
      return sliceTTLRef;
    },
    set sliceTTLRef(value: typeof sliceTTLRef) {
      sliceTTLRef = value;
    },
    get sliceRevokedRef() {
      return sliceRevokedRef;
    },
    set sliceRevokedRef(value: typeof sliceRevokedRef) {
      sliceRevokedRef = value;
    },
    get scope() {
      return scope;
    },
    get probeUrl() {
      return probeUrl;
    },
    set probeUrl(value: typeof probeUrl) {
      probeUrl = value;
    },
    get revokeCapabilityTracked() {
      return revokeCapabilityTracked;
    },
    get identityDeps() {
      return identityDeps;
    },
    get grantSliceRead() {
      return grantSliceRead;
    },
    set grantSliceRead(value: typeof grantSliceRead) {
      grantSliceRead = value;
    },
    get grantGeneric() {
      return grantGeneric;
    },
    get grantResolve() {
      return grantResolve;
    },
    set grantResolve(value: typeof grantResolve) {
      grantResolve = value;
    },
    get grant() {
      return grant;
    },
    get other() {
      return other;
    },
    get issueBuildDecision() {
      return issueBuildDecision;
    },
    get issueReadDecision() {
      return issueReadDecision;
    },
    get attemptRead() {
      return attemptRead;
    },
    get readEnvelope() {
      return readEnvelope;
    },
    get grantCtxBuild() {
      return grantCtxBuild;
    },
    set grantCtxBuild(value: typeof grantCtxBuild) {
      grantCtxBuild = value;
    },
    get committedPayload() {
      return committedPayload;
    },
    get countRows() {
      return countRows;
    },
    get sessionFor() {
      return sessionFor;
    },
    get teDb() {
      return teDb;
    },
    set teDb(value: typeof teDb) {
      teDb = value;
    },
    get runnerContext() {
      return runnerContext;
    },
    get asAppRole() {
      return asAppRole;
    },
    get tePool() {
      return tePool;
    },
    set tePool(value: typeof tePool) {
      tePool = value;
    },
    get preparedRead() {
      return preparedRead;
    },
    get legacyFixtureOf() {
      return legacyFixtureOf;
    },
    get importLegacySnapshot() {
      return importLegacySnapshot;
    },
    get closedContractRef() {
      return closedContractRef;
    },
    get legacySnapshotRefOf() {
      return legacySnapshotRefOf;
    },
    get legacySnapshotRow() {
      return legacySnapshotRow;
    },
    get authorizeCommandTracked() {
      return authorizeCommandTracked;
    },
    get operatorActorRef() {
      return operatorActorRef;
    },
    set operatorActorRef(value: typeof operatorActorRef) {
      operatorActorRef = value;
    },
    get grantPolicySnapshotReference() {
      return grantPolicySnapshotReference;
    },
    get grantCtxRead() {
      return grantCtxRead;
    },
    set grantCtxRead(value: typeof grantCtxRead) {
      grantCtxRead = value;
    },
    get operator() {
      return operator;
    },
    get registry() {
      return registry;
    },
    get sliceMixRef() {
      return sliceMixRef;
    },
    set sliceMixRef(value: typeof sliceMixRef) {
      sliceMixRef = value;
    },
    get createWorkOrderResult() {
      return createWorkOrderResult;
    },
    get teFactCounts() {
      return teFactCounts;
    },
    get ownerStatement() {
      return ownerStatement;
    },
    get draftReadDecisionRows() {
      return draftReadDecisionRows;
    },
    get ipDraftReadDeniedAudits() {
      return ipDraftReadDeniedAudits;
    },
    get grantCtxDraftRead() {
      return grantCtxDraftRead;
    },
    set grantCtxDraftRead(value: typeof grantCtxDraftRead) {
      grantCtxDraftRead = value;
    },
    get recordPolicySnapshotTracked() {
      return recordPolicySnapshotTracked;
    },
    get registerPolicyVersionAs() {
      return registerPolicyVersionAs;
    },
    get enterpriseProjectDb() {
      return enterpriseProjectDb;
    },
    set enterpriseProjectDb(value: typeof enterpriseProjectDb) {
      enterpriseProjectDb = value;
    },
    get identityDb() {
      return identityDb;
    },
    set identityDb(value: typeof identityDb) {
      identityDb = value;
    },
    get identityRepo() {
      return identityRepo;
    },
    set identityRepo(value: typeof identityRepo) {
      identityRepo = value;
    },
    get crypto() {
      return crypto;
    },
    get activeDatabaseUrl() {
      return activeDatabaseUrl;
    },
    get prepareIndependentGrants() {
      return prepareIndependentGrants;
    },
    get phase() {
      return phase;
    },
    get verifyDeliveryTail() {
      return verifyDeliveryTail;
    },
    get readyTaskForValidation() {
      return readyTaskForValidation;
    },
    get waitForDeadline() {
      return waitForDeadline;
    },
    get identityContext() {
      return identityContext;
    },
    get progress() {
      return progress;
    },
    get captureSlice() {
      return captureSlice;
    },
    get observeEntry() {
      return observeEntry;
    },
    get cleanupResources() {
      return cleanupResources;
    },
    drain,
    dispose,
    get prepareSuite() {
      return prepareSuite;
    },
    get deliveryTestEntries() {
      return deliveryTestEntries;
    },
  };
}
export type InitialContextSuite = ReturnType<typeof createInitialContextSuite>;
