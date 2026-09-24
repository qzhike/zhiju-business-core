import { ContractRegistry, type Common, type TaskExecution } from '@zhiju/contracts';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  createControlledFirstRunAuthorizationPort,
  issueExecutionCapabilityBundle,
  readExecutionCapabilityBundle,
  readIntegrityForExpiry,
  type ControlledFirstRunCapabilityCodes,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';
import {
  handleCreateFirstRun,
  handleGetContextSnapshot,
  handleGetRunDispatchBinding,
  handleGetRunState,
  handleGetAcceptedAgentResult,
  handleSubmitFinalResult,
  handleRecordRunResult,
  handleValidateFinalResult,
  handleAcceptFinalResult,
  handleFinalizeFirstRun,
  handleExpireFirstRun,
  handleGetWorkOrderContract,
  handleQueueWorkOrder,
  handleReconcileFirstRun,
  handleStartFirstRun,
  type CommandEnvelope,
  type ControlledFirstRunPorts,
  type ControlledFinalPorts,
  type TaskExecutionTransactionContext,
} from '@zhiju/task-execution';
import {
  ControlledRuntimeDispatchService,
  type IntegrationRendererDb,
  type RenderObjectStoragePort,
  type SyntheticRuntimeDriver,
} from '@zhiju/integration-gateway';
import type { Kysely } from 'kysely';
import {
  assertActorBinding,
  assertIntegrity,
  createDecisionBoundary,
  decisionReference,
  entryError,
  payloadHashOf,
  record,
  sessionAuthenticationContextHash,
  type DecisionRow,
} from './decision-boundary.js';
import type { InitialContextEntryConfig, InitialContextSession } from './initial-context-entry.js';
import { createWorkOrderDependencyReads } from './work-order-dependency-reads.js';

/** The transport supplies trusted module handles and one code for each approved boundary. */
export interface ControlledFirstRunEntryConfig extends Omit<
  InitialContextEntryConfig,
  'capabilityCodes'
> {
  readonly capabilityCodes: ControlledFirstRunCapabilityCodes;
  readonly integrationGatewayDb: Kysely<IntegrationRendererDb>;
  readonly runtimeDriver: SyntheticRuntimeDriver;
  readonly receiptStorage: RenderObjectStoragePort;
}

/** The transport records the trusted start instant before signing the Decision. */
export interface ControlledFirstRunSession extends InitialContextSession {
  readonly serviceEntryAt?: Date;
}

type Boundary = keyof ControlledFirstRunCapabilityCodes;

function identityContext(row: DecisionRow): IdentityTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: row.principal_id,
    actorSnapshotId: row.actor_snapshot_id,
    authorizationDecisionId: row.authorization_decision_id,
    authorizationDecisionHash: row.payload_hash,
    authorizationDecisionExpiresAt: row.expires_at,
    enterpriseId: row.enterprise_id,
    allowedProjectIds: row.project_id === null ? [] : [row.project_id],
    correlationId: row.authorization_decision_id,
  };
}

export function createControlledFirstRunEntry(config: ControlledFirstRunEntryConfig) {
  const registry = new ContractRegistry();
  const boundary = createDecisionBoundary(config);
  const auth = createControlledFirstRunAuthorizationPort({
    capabilityCodes: config.capabilityCodes,
    ...(config.now === undefined ? {} : { now: config.now }),
  });
  const now = config.now ?? (() => new Date());

  async function prepare(value: unknown, session: InitialContextSession, type: string) {
    const envelope = record(structuredClone(value));
    const query =
      type === 'integration.get_runtime_attempt_binding' ||
      type === 'integration.get_runtime_final_observation' ||
      type === 'execution.get_agent_result' ||
      type === 'execution.get_run_state';
    if (
      (query ? envelope.queryType : envelope.commandType) !== type ||
      (query ? envelope.queryVersion : envelope.commandVersion) !== '1.0'
    )
      entryError('API_CONTRACT_TYPE_UNKNOWN', 'unsupported first Run operation');
    if (!registry.validateOperation(type, '1.0', envelope).valid)
      entryError('API_VALUE_INVALID', 'invalid first Run envelope');
    const payload = record(envelope.payload) as CanonicalJsonObject;
    const payloadHash = payloadHashOf(payload);
    const sessionHash = sessionAuthenticationContextHash(session);
    if (!query) assertIntegrity(envelope.integrity, payloadHash);
    else if (
      envelope.consistencyRequirement !== 'AUTHORITATIVE' ||
      record(record(envelope.authenticationContextRef).contentHash).digest !==
        sessionHash.toString('hex')
    )
      entryError('AUTHORIZATION_DECISION_INVALID', 'query authentication mismatch');
    const scope = record(envelope.scopeRef);
    if (typeof scope.enterpriseId !== 'string' || typeof scope.projectId !== 'string')
      entryError('SCOPE_MISMATCH', 'Project scope required');
    const decisionRef = decisionReference(envelope.authorizationDecisionRef);
    const row = await boundary.readDecisionRow(decisionRef, {
      scopeKind: 'PROJECT',
      enterpriseId: scope.enterpriseId,
      projectId: scope.projectId,
    });
    assertActorBinding(query ? envelope.requester : envelope.actor, row);
    assertActorBinding(session.resolutionActorSnapshotRef, row);
    const target = (
      query ? (payload.runRef ?? payload.attemptRef ?? payload.agentResultRef) : envelope.targetRef
    ) as Common.ObjectRef;
    const deps = boundary.identityDeps(identityContext(row));
    const common = {
      actorSnapshotRef: session.resolutionActorSnapshotRef,
      commandType: type,
      commandVersion: '1.0',
      commandPayloadHash: payloadHash,
      authenticationContextHash: sessionHash,
    };
    const revalidation = {
      decisionRef,
      expectedCommandType: type,
      expectedCommandVersion: '1.0',
      expectedCommandPayloadHash: payloadHash,
      expectedAuthenticationContextHash: sessionHash,
      expectedTargetRef: target,
    };
    const ownKey = (
      {
        'execution.queue_work_order': 'workOrderQueueV1',
        'identity.issue_execution_capability_bundle': 'executionBundleIssueV1',
        'execution.create_run': 'runCreateV1',
        'integration.request_runtime_dispatch': 'runtimeDispatchV1',
        'integration.get_runtime_attempt_binding': 'runtimeAttemptBindingReadV1',
        'execution.start_run': 'runStartV1',
        'execution.reconcile_work_order_execution': 'workOrderReconcileV1',
        'integration.get_runtime_final_observation': 'runtimeFinalReadV1',
        'execution.submit_agent_result': 'agentResultSubmitV1',
        'execution.record_run_result': 'runResultRecordV1',
        'execution.validate_agent_result': 'agentResultValidateV1',
        'execution.accept_agent_result': 'agentResultAcceptV1',
        'execution.finalize_run_from_acceptance': 'runFinalizeV1',
        'execution.expire_run': 'runExpireV1',
        'execution.get_agent_result': 'agentResultReadV1',
        'execution.get_run_state': 'runStateReadV1',
      } as Record<string, Boundary>
    )[type];
    if (ownKey === undefined)
      entryError('API_CONTRACT_TYPE_UNKNOWN', 'unsupported first Run operation');
    const revalidateOwn = async () => {
      const result = await auth.revalidate(deps, ownKey, revalidation);
      if (!result.valid)
        entryError('AUTHORIZATION_REVOKED', 'first Run authorization is no longer current');
    };
    await revalidateOwn();
    const context: TaskExecutionTransactionContext = {
      ...identityContext(row),
      principalKind: row.principal_kind as TaskExecutionTransactionContext['principalKind'],
      policySnapshotId: row.policy_snapshot_id,
      correlationId: String(envelope.correlationId),
    };
    const internal: CommandEnvelope = {
      commandId: String(envelope.commandId),
      commandType: type,
      commandVersion: '1.0',
      idempotencyScope: `${type}@1.0:${scope.enterpriseId}:${scope.projectId}`,
      idempotencyKey: String(envelope.idempotencyKey),
      requestPayload: payload,
      enterpriseId: scope.enterpriseId,
      projectId: scope.projectId,
      targetType: String(record(target).objectType),
      targetId: String(record(target).objectId),
      expectedAggregateVersion:
        envelope.expectedAggregateVersion === undefined
          ? undefined
          : typeof envelope.expectedAggregateVersion === 'number'
            ? envelope.expectedAggregateVersion.toString()
            : (envelope.expectedAggregateVersion as string),
      correlationId: String(envelope.correlationId),
      causationId:
        envelope.causationId === undefined ? undefined : (envelope.causationId as string),
      principalId: row.principal_id,
      principalKind: context.principalKind,
      actorSnapshotId: row.actor_snapshot_id,
      authorizationDecisionId: row.authorization_decision_id,
      policySnapshotId: row.policy_snapshot_id,
    };
    const expiries: string[] = [row.expires_at.toISOString()];
    const checks: (() => Promise<void>)[] = [revalidateOwn];
    const mint = async (
      key: Boundary,
      ref: CanonicalJsonObject,
      override?: string,
      overridePayload?: CanonicalJsonObject,
    ) => {
      const consumer = override ?? type;
      const consumerHash =
        override === undefined ? payloadHash : payloadHashOf(overridePayload ?? { targetRef: ref });
      const result = await auth.authorize(deps, key, {
        ...common,
        commandType: consumer,
        commandPayloadHash: consumerHash,
        targetRef: ref as unknown as Common.ObjectRef,
      });
      if (result.outcome !== 'ALLOW')
        entryError('AUTHORIZATION_REVOKED', 'first Run dependency read denied');
      const proof = async () => {
        const validity = await auth.revalidate(deps, key, {
          ...revalidation,
          decisionRef: result.authorizationDecisionRef,
          expectedCommandType: consumer,
          expectedCommandPayloadHash: consumerHash,
          expectedTargetRef: ref as unknown as Common.ObjectRef,
        });
        if (!validity.valid)
          entryError('AUTHORIZATION_REVOKED', 'first Run dependency read revoked');
      };
      await proof();
      checks.push(proof);
      expiries.push(result.expiresAt);
      const ownContext = {
        ...context,
        authorizationDecisionId: result.authorizationDecisionRef.objectId,
        authorizationDecisionHash: Buffer.from(
          result.authorizationDecisionRef.contentHash.digest,
          'hex',
        ),
        authorizationDecisionExpiresAt: new Date(result.expiresAt),
      };
      return { proof, context: ownContext };
    };
    const revalidateAll = async () => {
      for (const check of checks) await check();
    };
    return { envelope, payload, target, row, context, internal, mint, revalidateAll, expiries };
  }

  function ports(
    prepared: Awaited<ReturnType<typeof prepare>>,
    session: ControlledFirstRunSession,
  ): ControlledFirstRunPorts {
    const { row, context, mint, revalidateAll, expiries } = prepared;
    const readers = createWorkOrderDependencyReads(config, row, session);
    const revalidateDependencies = async () => {
      await revalidateAll();
      await readers.revalidate();
    };
    const consumer = prepared.internal.commandType;
    const prefix =
      consumer === 'identity.issue_execution_capability_bundle'
        ? 'bundleIssue'
        : consumer === 'execution.queue_work_order'
          ? 'queue'
          : consumer === 'execution.create_run'
            ? 'runCreate'
            : undefined;
    const contractProof = async (ref: CanonicalJsonObject) =>
      prefix === undefined
        ? { proof: revalidateDependencies, context }
        : mint(`${prefix}ContractReadV1` as Boundary, ref);
    const contextProof = async (ref: CanonicalJsonObject) =>
      prefix === undefined
        ? { proof: revalidateDependencies, context }
        : mint(`${prefix}ContextReadV1` as Boundary, ref);
    return {
      now,
      trustedStartedAt:
        session.serviceEntryAt instanceof Date && Number.isFinite(session.serviceEntryAt.getTime())
          ? session.serviceEntryAt.toISOString()
          : undefined,
      decisionExpiresAt: row.expires_at.toISOString(),
      revalidateAuthorization: revalidateDependencies,
      additionalExpiries: () => [...expiries, ...readers.decisionExpiries()],
      readContract: async (ref) => {
        const proof = await contractProof(ref);
        return handleGetWorkOrderContract(config.taskExecutionDb, proof.context, ref, proof.proof);
      },
      readContext: async (ref) => {
        const proof = await contextProof(ref);
        await proof.proof();
        const view = await handleGetContextSnapshot(config.taskExecutionDb, proof.context, {
          commandVersion: '1.0',
          payload: { contextSnapshotRef: ref },
        });
        await proof.proof();
        if (view.status !== 'FOUND')
          entryError('REFERENCE_INVALID', 'Context Snapshot unavailable');
        return view.resultPayload as unknown as {
          contextSnapshotRef: CanonicalJsonObject;
          projectContextContract: CanonicalJsonObject;
        };
      },
      resolveControls: async (ref) =>
        (await readers.resolvePolicy(ref)) as unknown as Awaited<
          ReturnType<ControlledFirstRunPorts['resolveControls']>
        >,
      readBundle: async (ref, runRef) => {
        const key: Boundary =
          consumer === 'integration.request_runtime_dispatch'
            ? 'runtimeDispatchBundleReadV1'
            : consumer === 'execution.start_run'
              ? 'runStartBundleReadV1'
              : 'runCreateBundleReadV1';
        const proof = await mint(key, ref);
        return readExecutionCapabilityBundle(
          config.identity.db,
          proof.context,
          ref,
          runRef,
          proof.proof,
          now,
        );
      },
      readAttempt: async (ref) => {
        const proof = await mint('runStartAttemptReadV1', ref);
        const service = new ControlledRuntimeDispatchService(
          config.integrationGatewayDb,
          config.runtimeDriver,
          config.receiptStorage,
          {
            now,
            revalidateAuthorization: proof.proof,
            readDispatchBinding: () => Promise.reject(new Error('unused')),
            readBundle: () => Promise.reject(new Error('unused')),
            authorizeReceipt: () => Promise.reject(new Error('unused')),
          },
        );
        return (await service.getBinding(
          proof.context,
          ref as unknown as Common.ObjectRef,
        )) as unknown as CanonicalJsonObject;
      },
      readRuntimeAdapterIdentity: async (ref) => {
        const proof = await mint('runStartAdapterIdentityReadV1', ref);
        const service = new ControlledRuntimeDispatchService(
          config.integrationGatewayDb,
          config.runtimeDriver,
          config.receiptStorage,
          {
            now,
            revalidateAuthorization: proof.proof,
            readDispatchBinding: () => Promise.reject(new Error('unused')),
            readBundle: () => Promise.reject(new Error('unused')),
            authorizeReceipt: () => Promise.reject(new Error('unused')),
          },
        );
        return service.readRuntimeAdapterIdentityForAttempt(
          proof.context,
          ref as unknown as Common.ObjectRef,
        ) as unknown as Promise<
          Awaited<ReturnType<ControlledFirstRunPorts['readRuntimeAdapterIdentity']>>
        >;
      },
      readRunState: async (ref) => {
        const proof = await mint('workOrderReconcileRunReadV1', ref);
        return handleGetRunState(config.taskExecutionDb, proof.context, ref, proof.proof);
      },
    };
  }

  function finalPorts(
    prepared: Awaited<ReturnType<typeof prepare>>,
    session: ControlledFirstRunSession,
  ): ControlledFinalPorts {
    const { mint, revalidateAll, row } = prepared;
    const consumer = prepared.internal.commandType;
    const readers = createWorkOrderDependencyReads(config, row, session);
    const keys = (
      {
        'execution.submit_agent_result': [
          'resultSubmitBindingReadV1',
          'resultSubmitFinalReadV1',
          'resultSubmitBundleReadV1',
          'resultSubmitPolicyReadV1',
          undefined,
        ],
        'execution.record_run_result': [
          'resultRecordBindingReadV1',
          'resultRecordFinalReadV1',
          'resultRecordBundleReadV1',
          'resultRecordPolicyReadV1',
          'resultRecordSourceReadV1',
        ],
        'execution.validate_agent_result': [
          'resultValidateBindingReadV1',
          'resultValidateFinalReadV1',
          'resultValidateBundleReadV1',
          'resultValidatePolicyReadV1',
          'resultValidateSourceReadV1',
        ],
        'execution.accept_agent_result': [
          'resultAcceptBindingReadV1',
          'resultAcceptFinalReadV1',
          'resultAcceptBundleReadV1',
          'resultAcceptPolicyReadV1',
          'resultAcceptSourceReadV1',
        ],
        'execution.finalize_run_from_acceptance': [
          'runFinalizeBindingReadV1',
          'runFinalizeFinalReadV1',
          'runFinalizeBundleReadV1',
          'runFinalizePolicyReadV1',
          'runFinalizeSourceReadV1',
        ],
      } as Record<string, readonly [Boundary, Boundary, Boundary, Boundary, Boundary | undefined]>
    )[consumer];
    const runtimeService = (proof: Awaited<ReturnType<typeof mint>>) =>
      new ControlledRuntimeDispatchService(
        config.integrationGatewayDb,
        config.runtimeDriver,
        config.receiptStorage,
        {
          now,
          revalidateAuthorization: proof.proof,
          readDispatchBinding: () => Promise.reject(new Error('unused')),
          readBundle: () => Promise.reject(new Error('unused')),
          authorizeReceipt: () => Promise.reject(new Error('unused')),
        },
      );
    const proofFor = async (key: Boundary, ref: CanonicalJsonObject) => mint(key, ref);
    return {
      now,
      authorizationValidUntil: () =>
        new Date(Math.min(...prepared.expiries.map((expiry) => Date.parse(expiry)))),
      revalidateAuthorization: async () => {
        await revalidateAll();
        await readers.revalidate();
      },
      readBinding: async (ref) => {
        if (keys === undefined) entryError('API_CONTRACT_TYPE_UNKNOWN', 'binding read unavailable');
        const proof = await proofFor(keys[0], ref);
        return runtimeService(proof).getBinding(
          proof.context,
          ref as unknown as Common.ObjectRef,
        ) as unknown as Promise<CanonicalJsonObject>;
      },
      readFinal: async (ref) => {
        if (keys === undefined) entryError('API_CONTRACT_TYPE_UNKNOWN', 'final read unavailable');
        const proof = await proofFor(keys[1], ref);
        return runtimeService(proof).getFinal(
          proof.context,
          ref as unknown as Common.ObjectRef,
        ) as unknown as Promise<CanonicalJsonObject>;
      },
      readBundle: async (ref, runRef) => {
        if (keys === undefined) entryError('API_CONTRACT_TYPE_UNKNOWN', 'bundle read unavailable');
        const proof = await proofFor(keys[2], ref);
        return readExecutionCapabilityBundle(
          config.identity.db,
          proof.context,
          ref,
          runRef,
          proof.proof,
          now,
        );
      },
      resolveControls: async (ref) => {
        if (keys === undefined) entryError('API_CONTRACT_TYPE_UNKNOWN', 'policy read unavailable');
        const proof = await proofFor(keys[3], ref);
        await proof.proof();
        const view = await readers.resolvePolicy(ref);
        await proof.proof();
        return view as unknown as Awaited<ReturnType<ControlledFinalPorts['resolveControls']>>;
      },
      readSource: async (ref) => {
        if (keys?.[4] === undefined)
          entryError('API_CONTRACT_TYPE_UNKNOWN', 'source read unavailable');
        const proof = await proofFor(keys[4], ref);
        await proof.proof();
      },
      inspectExpiredBundle: async (ref, runRef) => {
        const proof = await proofFor('runExpireBundleInspectV1', ref);
        await readIntegrityForExpiry(config.identity.db, proof.context, ref, runRef, proof.proof);
      },
    };
  }

  async function command(type: string, value: unknown, session: ControlledFirstRunSession) {
    const prepared = await prepare(value, session, type);
    const p = ports(prepared, session);
    const { context, internal, payload, mint } = prepared;
    if (type === 'execution.submit_agent_result')
      return handleSubmitFinalResult(
        config.taskExecutionDb,
        context,
        internal,
        finalPorts(prepared, session),
      );
    if (type === 'execution.record_run_result')
      return handleRecordRunResult(
        config.taskExecutionDb,
        context,
        internal,
        finalPorts(prepared, session),
      );
    if (type === 'execution.validate_agent_result')
      return handleValidateFinalResult(
        config.taskExecutionDb,
        context,
        internal,
        finalPorts(prepared, session),
      );
    if (type === 'execution.accept_agent_result')
      return handleAcceptFinalResult(
        config.taskExecutionDb,
        context,
        internal,
        finalPorts(prepared, session),
      );
    if (type === 'execution.finalize_run_from_acceptance')
      return handleFinalizeFirstRun(
        config.taskExecutionDb,
        context,
        internal,
        finalPorts(prepared, session),
      );
    if (type === 'execution.expire_run')
      return handleExpireFirstRun(
        config.taskExecutionDb,
        context,
        internal,
        finalPorts(prepared, session),
      );
    if (type === 'execution.queue_work_order')
      return handleQueueWorkOrder(config.taskExecutionDb, context, internal, p);
    if (type === 'identity.issue_execution_capability_bundle')
      return issueExecutionCapabilityBundle(
        config.identity.db,
        context,
        { ...internal, platform: false },
        p,
      );
    if (type === 'execution.create_run')
      return handleCreateFirstRun(config.taskExecutionDb, context, internal, p);
    if (type === 'execution.start_run') {
      const result = await handleStartFirstRun(config.taskExecutionDb, context, internal, p);
      if (
        (result.status === 'COMMITTED' ||
          (result.status === 'DUPLICATE' && result.originalOutcome === 'COMMITTED')) &&
        config.runtimeDriver.releaseFinal !== undefined
      )
        await config.runtimeDriver.releaseFinal(
          record(payload.runtimeAttemptRef) as unknown as Common.ObjectRef,
        );
      return result;
    }
    if (type === 'execution.reconcile_work_order_execution')
      return handleReconcileFirstRun(config.taskExecutionDb, context, internal, p);
    if (type !== 'integration.request_runtime_dispatch')
      entryError('API_CONTRACT_TYPE_UNKNOWN', 'unsupported first Run command');
    const request = record(payload.request) as CanonicalJsonObject;
    const service = new ControlledRuntimeDispatchService(
      config.integrationGatewayDb,
      config.runtimeDriver,
      config.receiptStorage,
      {
        now,
        revalidateAuthorization: p.revalidateAuthorization,
        readDispatchBinding: async (runRef) => {
          const proof = await mint(
            'runDispatchBindingReadV1',
            runRef as unknown as CanonicalJsonObject,
            'execution.get_run_dispatch_binding',
            { runRef: runRef as unknown as CanonicalJsonObject },
          );
          return (await handleGetRunDispatchBinding(
            config.taskExecutionDb,
            proof.context,
            runRef as unknown as CanonicalJsonObject,
            {
              ...p,
              revalidateAuthorization: async () => {
                await proof.proof();
                await p.revalidateAuthorization();
              },
            },
          )) as unknown as TaskExecution.ExecutionGetRunDispatchBindingResult;
        },
        readBundle: p.readBundle as never,
        authorizeReceipt: async (ref, receipt) => {
          const proof = await mint(
            'runtimeReceiptRecordV1',
            ref as unknown as CanonicalJsonObject,
            'integration.record_external_receipt',
            { receipt },
          );
          return proof.proof;
        },
      },
    );
    return service.dispatch(context, {
      attemptRef: prepared.target,
      request: request as never,
      command: {
        commandId: internal.commandId,
        idempotencyScope: internal.idempotencyScope,
        idempotencyKey: internal.idempotencyKey,
        correlationId: internal.correlationId,
        ...(internal.causationId === undefined ? {} : { causationId: internal.causationId }),
      },
    });
  }

  return {
    queue: (value: unknown, session: InitialContextSession) =>
      command('execution.queue_work_order', value, session),
    issueBundle: (value: unknown, session: InitialContextSession) =>
      command('identity.issue_execution_capability_bundle', value, session),
    createRun: (value: unknown, session: InitialContextSession) =>
      command('execution.create_run', value, session),
    dispatch: (value: unknown, session: InitialContextSession) =>
      command('integration.request_runtime_dispatch', value, session),
    startRun: (value: unknown, session: ControlledFirstRunSession) =>
      command('execution.start_run', value, session),
    reconcile: (value: unknown, session: InitialContextSession) =>
      command('execution.reconcile_work_order_execution', value, session),
    submitAgentResult: (value: unknown, session: ControlledFirstRunSession) =>
      command('execution.submit_agent_result', value, session),
    recordRunResult: (value: unknown, session: ControlledFirstRunSession) =>
      command('execution.record_run_result', value, session),
    validateAgentResult: (value: unknown, session: ControlledFirstRunSession) =>
      command('execution.validate_agent_result', value, session),
    acceptAgentResult: (value: unknown, session: ControlledFirstRunSession) =>
      command('execution.accept_agent_result', value, session),
    finalizeRun: (value: unknown, session: ControlledFirstRunSession) =>
      command('execution.finalize_run_from_acceptance', value, session),
    expireRun: (value: unknown, session: ControlledFirstRunSession) =>
      command('execution.expire_run', value, session),
    async getAgentResult(value: unknown, session: ControlledFirstRunSession) {
      const prepared = await prepare(value, session, 'execution.get_agent_result');
      return handleGetAcceptedAgentResult(
        config.taskExecutionDb,
        prepared.context,
        record(prepared.payload.agentResultRef) as CanonicalJsonObject,
        prepared.revalidateAll,
      );
    },
    async getRunState(value: unknown, session: ControlledFirstRunSession) {
      const prepared = await prepare(value, session, 'execution.get_run_state');
      return handleGetRunState(
        config.taskExecutionDb,
        prepared.context,
        record(prepared.payload.runRef) as CanonicalJsonObject,
        prepared.revalidateAll,
      );
    },
    async getRuntimeFinalObservation(value: unknown, session: ControlledFirstRunSession) {
      const prepared = await prepare(value, session, 'integration.get_runtime_final_observation');
      const service = new ControlledRuntimeDispatchService(
        config.integrationGatewayDb,
        config.runtimeDriver,
        config.receiptStorage,
        {
          now,
          revalidateAuthorization: prepared.revalidateAll,
          readDispatchBinding: () => Promise.reject(new Error('unused')),
          readBundle: () => Promise.reject(new Error('unused')),
          authorizeReceipt: () => Promise.reject(new Error('unused')),
        },
      );
      return service.getFinal(prepared.context, prepared.target);
    },
    async observeRuntimeFinal(value: unknown, session: ControlledFirstRunSession) {
      const prepared = await prepare(value, session, 'integration.get_runtime_final_observation');
      const proof = await prepared.mint(
        'runtimeFinalObserveV1',
        prepared.target as unknown as CanonicalJsonObject,
        'integration.get_runtime_final_observation',
        prepared.payload,
      );
      const service = new ControlledRuntimeDispatchService(
        config.integrationGatewayDb,
        config.runtimeDriver,
        config.receiptStorage,
        {
          now,
          revalidateAuthorization: proof.proof,
          readDispatchBinding: () => Promise.reject(new Error('unused')),
          readBundle: () => Promise.reject(new Error('unused')),
          authorizeReceipt: () => Promise.reject(new Error('unused')),
        },
      );
      return service.observeFinal(proof.context, prepared.target);
    },
    async getRuntimeAttemptBinding(value: unknown, session: InitialContextSession) {
      const prepared = await prepare(value, session, 'integration.get_runtime_attempt_binding');
      const service = new ControlledRuntimeDispatchService(
        config.integrationGatewayDb,
        config.runtimeDriver,
        config.receiptStorage,
        {
          now,
          revalidateAuthorization: prepared.revalidateAll,
          readDispatchBinding: () => Promise.reject(new Error('unused')),
          readBundle: () => Promise.reject(new Error('unused')),
          authorizeReceipt: () => Promise.reject(new Error('unused')),
        },
      );
      return service.getBinding(prepared.context, prepared.target);
    },
  };
}
