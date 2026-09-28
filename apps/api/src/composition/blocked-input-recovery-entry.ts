import { ContractRegistry, type Common, type EnterpriseProject } from '@zhiju/contracts';
import { newUuidV7, sha256CanonicalJson, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  createRecoveryAuthorizationPort,
  readRecoveryHumanEligibility,
  type RecoveryCapabilityCodes,
  type IdentityTransactionContext,
  type RecoveryHumanEligibilityInput,
} from '@zhiju/identity-policy';
import {
  handleGetResolutionReceipt,
  handleProposeCustomerMaterial,
  handleConfirmCustomerMaterial,
  readConfirmationReceiptRef,
  readCustomerMaterialRecoveryReferences,
} from '@zhiju/enterprise-project';
import {
  handleOpenRecoveryRequest,
  handleSubmitRecoveryAnswer,
  handleResolveRecoveryRequest,
  handleScheduleRecoveryRetry,
  handleBuildFrozenRecoveryContext,
  handleReconcileRecoveryRoot,
  handleGetRecoveryRequest,
  handleGetTaskExecutionState,
  handleGetWorkOrderExecutionState,
  readFrozenContextEligibility,
  type CommandEnvelope,
  type RecoveryConsumer,
  type FrozenRecoveryContextPorts,
  type TaskExecutionTransactionContext,
} from '@zhiju/task-execution';
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
import { createWorkOrderDependencyReads } from './work-order-dependency-reads.js';
import type { InitialContextEntryConfig, InitialContextSession } from './initial-context-entry.js';

export interface BlockedInputRecoveryEntryConfig extends Omit<
  InitialContextEntryConfig,
  'capabilityCodes'
> {
  readonly recoveryCapabilityCodes: RecoveryCapabilityCodes;
  readonly humanCapabilityCodes: {
    readonly answerSubmit: string;
    readonly requestResolve: string;
    readonly materialRead: string;
  };
}
export interface RecoverySession extends InitialContextSession {
  readonly serviceEntryAt: Date;
}

/** Independent scan/progress rights; neither grants target business access. */
export async function createRecoveryProcessAuthorities(
  config: BlockedInputRecoveryEntryConfig,
  session: RecoverySession,
  scope: Common.ScopeRef,
  scanDecision: Common.ContentAddressedRef,
  progressDecision: Common.ContentAddressedRef,
) {
  const boundary = createDecisionBoundary(config),
    auth = createRecoveryAuthorizationPort({
      capabilityCodes: config.recoveryCapabilityCodes,
      ...(config.now === undefined ? {} : { now: config.now }),
    });
  if (!scope.enterpriseId || !scope.projectId) entryError('SCOPE_MISMATCH', 'Project required');
  const target: Common.ObjectRef = {
    kind: 'OBJECT',
    objectType: 'zhiju.project.project',
    objectId: scope.projectId,
    scope,
  };
  const sessionHash = sessionAuthenticationContextHash(session);
  async function bind(
    key: string,
    type: string,
    payload: CanonicalJsonObject,
    decisionRef: Common.ContentAddressedRef,
  ) {
    const row = await boundary.readDecisionRow(decisionRef, {
      scopeKind: 'PROJECT',
      enterpriseId: definedValue(scope.enterpriseId),
      projectId: definedValue(scope.projectId),
    });
    assertActorBinding(session.resolutionActorSnapshotRef, row);
    if (row.principal_kind !== 'SERVICE')
      entryError('AUTHORIZATION_REVOKED', 'Process requires Service');
    const revalidate = async () => {
      const proof = await auth.revalidate(boundary.identityDeps(identityContext(row)), key, {
        decisionRef,
        expectedCommandType: type,
        expectedCommandVersion: '1.0',
        expectedCommandPayloadHash: payloadHashOf(payload),
        expectedAuthenticationContextHash: sessionHash,
        expectedTargetRef: target,
      });
      if (!proof.valid) entryError('AUTHORIZATION_REVOKED', 'recovery Process authority revoked');
    };
    const context: TaskExecutionTransactionContext = {
      ...identityContext(row),
      principalKind: 'SERVICE',
      policySnapshotId: row.policy_snapshot_id,
    };
    await revalidate();
    return { row, context, revalidate };
  }
  const scan = await bind(
    'recoveryCandidateScanV1',
    'execution.recovery.candidate.scan',
    { scopeRef: scope },
    scanDecision,
  );
  const progress = await bind(
    'recoveryProcessProgressV1',
    'execution.process.recovery_progress',
    { scopeRef: scope, action: 'read_progress' },
    progressDecision,
  );
  const decisions = new Map<string, Common.ContentAddressedRef>();
  async function progressEnvelope(
    id: string,
    version: string | undefined,
    payload: CanonicalJsonObject,
  ): Promise<CommandEnvelope> {
    const result = await auth.authorize(
      boundary.identityDeps(identityContext(progress.row)),
      'recoveryProcessProgressV1',
      {
        actorSnapshotRef: session.resolutionActorSnapshotRef,
        commandType: 'execution.process.recovery_progress',
        commandVersion: '1.0',
        commandPayloadHash: payloadHashOf(payload),
        authenticationContextHash: sessionHash,
        targetRef: target,
      },
    );
    if (result.outcome !== 'ALLOW') entryError('AUTHORIZATION_REVOKED', 'Process progress denied');
    const commandId = newUuidV7();
    decisions.set(commandId, result.authorizationDecisionRef);
    return {
      commandId,
      commandType: 'execution.process.recovery_progress',
      commandVersion: '1.0',
      idempotencyScope: `blocked-input-recovery-progress:${scope.enterpriseId}:${scope.projectId}`,
      idempotencyKey: `${id}:${version ?? 'create'}:${sha256CanonicalJson(payload)}`,
      requestPayload: payload,
      enterpriseId: definedValue(scope.enterpriseId),
      projectId: definedValue(scope.projectId),
      targetType: 'ProcessInstance',
      targetId: id,
      ...(version === undefined ? {} : { expectedAggregateVersion: version }),
      correlationId: commandId,
      principalId: progress.row.principal_id,
      principalKind: 'SERVICE',
      actorSnapshotId: progress.row.actor_snapshot_id,
      authorizationDecisionId: result.authorizationDecisionRef.objectId,
      policySnapshotId: progress.row.policy_snapshot_id,
    };
  }
  async function progressAuthority(env: CommandEnvelope) {
    const decision = decisions.get(env.commandId);
    if (!decision) entryError('AUTHORIZATION_DECISION_INVALID', 'unbound progress command');
    const result = await bind(
      'recoveryProcessProgressV1',
      env.commandType,
      env.requestPayload,
      decision,
    );
    return {
      context: { ...result.context, correlationId: env.correlationId },
      revalidate: result.revalidate,
    };
  }
  return {
    scanContext: scan.context,
    progressContext: progress.context,
    revalidateScan: scan.revalidate,
    revalidateProgress: progress.revalidate,
    progressEnvelope,
    progressAuthority,
  };
}
function identityContext(row: DecisionRow): IdentityTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: row.principal_id,
    actorSnapshotId: row.actor_snapshot_id,
    authorizationDecisionId: row.authorization_decision_id,
    authorizationDecisionHash: row.payload_hash,
    authorizationDecisionExpiresAt: row.expires_at,
    enterpriseId: row.enterprise_id,
    allowedProjectIds: [definedValue(row.project_id)],
    correlationId: row.authorization_decision_id,
  };
}
function mirror(ref: CanonicalJsonObject): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: requiredString(ref.objectType),
    objectId: requiredString(ref.objectId),
    scope: ref.scope as Common.ScopeRef,
  };
}
const operations = {
  'project.propose_customer_material': ['customerMaterialProposeV1', 'request_resolve'],
  'project.confirm_customer_material': ['customerMaterialConfirmV1', 'request_resolve'],
  'execution.open_information_request': ['informationRequestOpenV1', 'request_open'],
  'execution.get_information_request': ['informationRequestReadV1', 'request_resolve'],
  'execution.submit_information_answer': ['informationAnswerSubmitV1', 'answer_submit'],
  'execution.resolve_information_request': ['informationRequestResolveV1', 'request_resolve'],
  'execution.build_context_snapshot': ['frozenContextBuildV1_1', 'frozen_context_build'],
  'execution.schedule_work_order_retry': ['workOrderRetryScheduleV1', 'retry_schedule'],
  'execution.reconcile_task_execution': ['taskReconcileV1', 'task_reconcile'],
  'execution.get_task_state': ['taskStateReadV1', 'task_state'],
  'execution.get_work_order_execution_state': ['workOrderExecutionStateReadV1', 'work_order_state'],
} as const;

/** Owning reads under a fresh exact Decision for each consumer and dependency. */
export function createRecoveryDependencyPorts(
  config: BlockedInputRecoveryEntryConfig,
  row: DecisionRow,
  session: RecoverySession,
  consumer: RecoveryConsumer,
  revalidateOwn: () => Promise<void>,
): FrozenRecoveryContextPorts {
  const boundary = createDecisionBoundary(config),
    auth = createRecoveryAuthorizationPort({
      capabilityCodes: config.recoveryCapabilityCodes,
      ...(config.now === undefined ? {} : { now: config.now }),
    }),
    now = config.now ?? (() => new Date());
  const context = identityContext(row),
    deps = boundary.identityDeps(context),
    checks: (() => Promise<void>)[] = [revalidateOwn],
    expiries = [row.expires_at.getTime()];
  const readers = createWorkOrderDependencyReads(config, row, session);
  async function mint(dependency: string, ref: CanonicalJsonObject, payload: CanonicalJsonObject) {
    const key = `recovery.${consumer}.${dependency}.v1`,
      type = `execution.recovery.${consumer}.${dependency}`,
      target = mirror(ref),
      payloadHash = payloadHashOf(payload),
      sessionHash = sessionAuthenticationContextHash(session);
    const result = await auth.authorize(deps, key, {
      actorSnapshotRef: session.resolutionActorSnapshotRef,
      commandType: type,
      commandVersion: '1.0',
      commandPayloadHash: payloadHash,
      authenticationContextHash: sessionHash,
      targetRef: target,
    });
    if (result.outcome !== 'ALLOW')
      entryError('AUTHORIZATION_REVOKED', 'recovery dependency denied');
    const proof = async () => {
      const validity = await auth.revalidate(deps, key, {
        decisionRef: result.authorizationDecisionRef,
        expectedCommandType: type,
        expectedCommandVersion: '1.0',
        expectedCommandPayloadHash: payloadHash,
        expectedAuthenticationContextHash: sessionHash,
        expectedTargetRef: target,
      });
      if (!validity.valid) entryError('AUTHORIZATION_REVOKED', 'recovery dependency revoked');
    };
    await proof();
    checks.push(proof);
    expiries.push(Date.parse(result.expiresAt));
    const ownContext = {
      ...context,
      authorizationDecisionId: result.authorizationDecisionRef.objectId,
      authorizationDecisionHash: Buffer.from(
        result.authorizationDecisionRef.contentHash.digest,
        'hex',
      ),
      authorizationDecisionExpiresAt: new Date(result.expiresAt),
    };
    return {
      proof,
      context: ownContext,
      epContext: {
        ...boundary.enterpriseProjectContext(
          row,
          boundary.decisionScope(row),
          row.authorization_decision_id,
        ),
        ...ownContext,
        authorizationPurposes: [
          dependency === 'receipt'
            ? 'project.resolution_receipt.read'
            : 'project.customer_material.recovery_refs.read',
        ],
      },
    };
  }
  const ports: FrozenRecoveryContextPorts = {
    now,
    trustedEntryAt: session.serviceEntryAt.toISOString(),
    validUntil: () =>
      new Date(Math.min(...expiries, ...readers.decisionExpiries().map(Date.parse))),
    revalidateAuthorization: async () => {
      for (const check of checks) await check();
      await readers.revalidate();
    },
    authorizeLocalRead: async (dependency, target, payload) => {
      await mint(dependency, target, payload);
    },
    resolveControls: async (ref) => {
      const proof = await mint('controls', ref, { policyRef: ref });
      const view = await readers.resolvePolicy(ref);
      await proof.proof();
      return view as unknown as Awaited<ReturnType<FrozenRecoveryContextPorts['resolveControls']>>;
    },
    readMaterial: async (input) => {
      const proof = await mint(
        'material',
        record(input.candidateMaterialRef) as CanonicalJsonObject,
        input,
      );
      const result = await readCustomerMaterialRecoveryReferences(
        config.enterpriseProjectDb,
        proof.epContext,
        input as unknown as Parameters<typeof readCustomerMaterialRecoveryReferences>[2],
        proof.proof,
      );
      return result as unknown as CanonicalJsonObject;
    },
    readReceipt: async (ref) => {
      const proof = await mint('receipt', ref, { commandReceiptRef: ref });
      await proof.proof();
      const result = await handleGetResolutionReceipt(config.enterpriseProjectDb, proof.epContext, {
        commandReceiptRef: ref as unknown as Common.ContentAddressedRef & {
          objectType: 'zhiju.project.command_receipt';
        },
      });
      await proof.proof();
      return result as unknown as CanonicalJsonObject;
    },
    readHuman: async (input) => {
      const principal = record(input.principalRef),
        ref = {
          kind: 'OBJECT',
          objectType: 'zhiju.identity.principal',
          objectId: principal.principalId,
          scope: input.scopeRef,
        } as CanonicalJsonObject;
      const proof = await mint('human', ref, input);
      const result = await readRecoveryHumanEligibility(
        boundary.identityDeps(proof.context),
        input as unknown as RecoveryHumanEligibilityInput,
        {
          now,
          validUntil: ports.validUntil,
          revalidateAuthorization: proof.proof,
          requiredCapabilities: [
            {
              capabilityCode: config.humanCapabilityCodes.answerSubmit,
              action: 'execution.information_request.answer.submit.v1',
              targetObjectType: 'execution.information_request',
            },
            {
              capabilityCode: config.humanCapabilityCodes.requestResolve,
              action: 'execution.information_request.resolve.v1',
              targetObjectType: 'execution.information_request',
            },
            {
              capabilityCode: config.humanCapabilityCodes.materialRead,
              action: 'project.customer_material.recovery_refs.read.for_answer_submit.v1',
              targetObjectType: 'zhiju.project.customer_material',
            },
          ],
        },
      ).catch((error: unknown) => {
        if (
          error !== null &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'INVALID_PROVENANCE'
        )
          entryError(
            'EXECUTION_RESOLUTION_RECEIPT_INVALID',
            'confirmation provenance is unavailable',
          );
        throw error;
      });
      return result as unknown as CanonicalJsonObject;
    },
    resolveBuilder: async (ref) => {
      const view = await readers.resolvePolicy(ref);
      if (view.useStatus !== 'USABLE') entryError('POLICY_EXPIRED', 'builder policy unavailable');
      return {
        resolvedRef: view.policyRef as unknown as CanonicalJsonObject,
        contentHashDigest: view.contentHash.digest,
        effectiveFrom: view.effectiveFrom,
        ...(view.supersededAt === undefined ? {} : { supersededAt: view.supersededAt }),
        policySchemaRefs: view.policySchemaRefs,
        policyDocument: view.policyDocument,
      };
    },
    readSlice: async (ref) => {
      const result = await readers.slices.getContextSourceSlice({ sourceSliceRef: ref });
      if (!result) entryError('REFERENCE_INVALID', 'source slice unavailable');
      return result;
    },
  };
  return ports;
}

/** Authenticated local transport for the bounded recovery operations. */
export function createBlockedInputRecoveryEntry(config: BlockedInputRecoveryEntryConfig) {
  const registry = new ContractRegistry(),
    boundary = createDecisionBoundary(config),
    auth = createRecoveryAuthorizationPort({
      capabilityCodes: config.recoveryCapabilityCodes,
      ...(config.now === undefined ? {} : { now: config.now }),
    });
  async function prepare(value: unknown, session: RecoverySession) {
    const envelope = record(structuredClone(value)),
      query = typeof envelope.queryType === 'string',
      type = String(query ? envelope.queryType : envelope.commandType),
      version = String(query ? envelope.queryVersion : envelope.commandVersion),
      binding = Object.hasOwn(operations, type)
        ? operations[type as keyof typeof operations]
        : undefined;
    if (!binding || version !== (type === 'execution.build_context_snapshot' ? '1.1' : '1.0'))
      entryError('API_CONTRACT_TYPE_UNKNOWN', 'unsupported recovery operation');
    if (!registry.validateOperation(type, version, envelope).valid)
      entryError('API_VALUE_INVALID', 'invalid recovery envelope');
    if (
      !(session.serviceEntryAt instanceof Date) ||
      !Number.isFinite(session.serviceEntryAt.getTime())
    )
      entryError('API_VALUE_INVALID', 'trusted entry time required');
    const payload = record(envelope.payload) as CanonicalJsonObject,
      payloadHash = payloadHashOf(payload),
      sessionHash = sessionAuthenticationContextHash(session);
    if (query) {
      if (
        envelope.consistencyRequirement !== 'AUTHORITATIVE' ||
        record(record(envelope.authenticationContextRef).contentHash).digest !==
          sessionHash.toString('hex')
      )
        entryError('AUTHORIZATION_DECISION_INVALID', 'query session mismatch');
    } else assertIntegrity(envelope.integrity, payloadHash);
    const scope = record(envelope.scopeRef);
    if (typeof scope.enterpriseId !== 'string' || typeof scope.projectId !== 'string')
      entryError('SCOPE_MISMATCH', 'Project required');
    const decisionRef = decisionReference(envelope.authorizationDecisionRef),
      row = await boundary.readDecisionRow(decisionRef, {
        scopeKind: 'PROJECT',
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
      });
    assertActorBinding(query ? envelope.requester : envelope.actor, row);
    assertActorBinding(session.resolutionActorSnapshotRef, row);
    const target = (
      query
        ? (payload.informationRequestRef ?? payload.taskRef ?? payload.workOrderRef)
        : envelope.targetRef
    ) as Common.ObjectRef;
    const deps = boundary.identityDeps(identityContext(row));
    const ownGuard = async () => {
      const result = await auth.revalidate(deps, binding[0], {
        decisionRef,
        expectedCommandType: type,
        expectedCommandVersion: version,
        expectedCommandPayloadHash: payloadHash,
        expectedAuthenticationContextHash: sessionHash,
        expectedTargetRef: target,
      });
      if (!result.valid) entryError('AUTHORIZATION_REVOKED', 'recovery authority revoked');
    };
    const guard = async () => {
      await ownGuard();
      if (query && type === 'execution.get_information_request' && row.principal_kind === 'HUMAN') {
        await readRecoveryHumanEligibility(
          deps,
          {
            principalRef: { principalKind: 'HUMAN', principalId: row.principal_id },
            scopeRef: {
              enterpriseId: scope.enterpriseId as string,
              projectId: scope.projectId as string,
            },
            roleCode: 'project.customer_material.confirmer',
          },
          {
            now: config.now ?? (() => new Date()),
            validUntil: () => row.expires_at,
            revalidateAuthorization: ownGuard,
            requiredCapabilities: [
              {
                capabilityCode: definedValue(
                  config.recoveryCapabilityCodes.informationRequestReadV1,
                ),
                action: 'execution.information_request.read.v1',
                targetObjectType: 'execution.information_request',
              },
            ],
          },
        );
      }
    };
    await guard();
    const context: TaskExecutionTransactionContext = {
      ...identityContext(row),
      principalKind: row.principal_kind as TaskExecutionTransactionContext['principalKind'],
      policySnapshotId: row.policy_snapshot_id,
      correlationId: String(envelope.correlationId),
    };
    const env: CommandEnvelope = {
      commandId: String(envelope.commandId),
      commandType: type,
      commandVersion: version,
      idempotencyScope: `${type}@${version}:${scope.enterpriseId}:${scope.projectId}`,
      idempotencyKey: String(envelope.idempotencyKey),
      requestPayload: payload,
      enterpriseId: scope.enterpriseId,
      projectId: scope.projectId,
      targetType: target.objectType,
      targetId: target.objectId,
      expectedAggregateVersion:
        envelope.expectedAggregateVersion === undefined
          ? undefined
          : String(Number(envelope.expectedAggregateVersion)),
      correlationId: String(envelope.correlationId),
      causationId: envelope.causationId as string | undefined,
      principalId: row.principal_id,
      principalKind: context.principalKind,
      actorSnapshotId: row.actor_snapshot_id,
      authorizationDecisionId: row.authorization_decision_id,
      policySnapshotId: row.policy_snapshot_id,
    };
    return {
      type,
      payload,
      target,
      context,
      env,
      row,
      ports: createRecoveryDependencyPorts(config, row, session, binding[1], guard),
    };
  }
  return {
    async command(value: unknown, session: RecoverySession) {
      const p = await prepare(value, session),
        args = [config.taskExecutionDb, p.context, p.env, p.ports] as const;
      switch (p.type) {
        case 'project.propose_customer_material':
          return handleProposeCustomerMaterial(
            config.enterpriseProjectDb,
            boundary.enterpriseProjectContext(
              p.row,
              boundary.decisionScope(p.row),
              p.env.correlationId,
            ),
            {
              ...p.env,
              payload:
                p.payload as unknown as EnterpriseProject.ProjectProposeCustomerMaterialPayload,
            },
            p.ports.revalidateAuthorization,
          );
        case 'project.confirm_customer_material':
          return handleConfirmCustomerMaterial(
            config.enterpriseProjectDb,
            boundary.enterpriseProjectContext(
              p.row,
              boundary.decisionScope(p.row),
              p.env.correlationId,
            ),
            {
              ...p.env,
              payload:
                p.payload as unknown as EnterpriseProject.ProjectConfirmCustomerMaterialPayload,
            },
            p.ports.revalidateAuthorization,
          );
        case 'execution.open_information_request':
          return handleOpenRecoveryRequest(...args);
        case 'execution.submit_information_answer':
          return handleSubmitRecoveryAnswer(...args);
        case 'execution.resolve_information_request':
          return handleResolveRecoveryRequest(...args);
        case 'execution.build_context_snapshot':
          return handleBuildFrozenRecoveryContext(...args);
        case 'execution.schedule_work_order_retry':
          return handleScheduleRecoveryRetry(...args);
        case 'execution.reconcile_task_execution':
          return handleReconcileRecoveryRoot(...args);
        default:
          entryError('API_CONTRACT_TYPE_UNKNOWN', 'recovery command required');
      }
    },
    async discoverReceipt(
      commandId: string,
      session: RecoverySession,
      decision: Common.ContentAddressedRef,
      scope: Common.ScopeRef,
    ) {
      const payload = { commandId, scopeRef: scope },
        target = {
          kind: 'OBJECT' as const,
          objectType: 'zhiju.project.command_receipt',
          objectId: commandId,
          scope,
        };
      if (!scope.enterpriseId || !scope.projectId) entryError('SCOPE_MISMATCH', 'Project required');
      const row = await boundary.readDecisionRow(decision, {
        scopeKind: 'PROJECT',
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
      });
      assertActorBinding(session.resolutionActorSnapshotRef, row);
      const guard = async () => {
        const result = await auth.revalidate(
          boundary.identityDeps(identityContext(row)),
          'confirmationReceiptDiscoverV1',
          {
            decisionRef: decision,
            expectedCommandType: 'project.confirmation_receipt.discover',
            expectedCommandVersion: '1.0',
            expectedCommandPayloadHash: payloadHashOf(payload),
            expectedAuthenticationContextHash: sessionAuthenticationContextHash(session),
            expectedTargetRef: target,
          },
        );
        if (!result.valid) entryError('AUTHORIZATION_REVOKED', 'receipt discovery revoked');
      };
      await guard();
      return readConfirmationReceiptRef(
        config.enterpriseProjectDb,
        boundary.enterpriseProjectContext(row, boundary.decisionScope(row), commandId),
        payload,
        guard,
      );
    },
    async read(value: unknown, session: RecoverySession) {
      const p = await prepare(value, session);
      switch (p.type) {
        case 'execution.get_information_request':
          return handleGetRecoveryRequest(
            config.taskExecutionDb,
            p.context,
            p.target as unknown as CanonicalJsonObject,
            p.ports,
          );
        case 'execution.get_task_state':
          return handleGetTaskExecutionState(
            config.taskExecutionDb,
            p.context,
            p.target as unknown as CanonicalJsonObject,
            p.ports,
          );
        case 'execution.get_work_order_execution_state':
          return handleGetWorkOrderExecutionState(
            config.taskExecutionDb,
            p.context,
            p.target as unknown as CanonicalJsonObject,
            p.ports,
          );
        default:
          entryError('API_CONTRACT_TYPE_UNKNOWN', 'recovery query required');
      }
    },
  };
}
export async function readFrozenEligibilityForConsumer(
  config: BlockedInputRecoveryEntryConfig,
  row: DecisionRow,
  session: RecoverySession,
  consumer: RecoveryConsumer,
  guard: () => Promise<void>,
  contextRef: CanonicalJsonObject,
  contractRef: CanonicalJsonObject,
) {
  const ports = createRecoveryDependencyPorts(config, row, session, consumer, guard);
  // Eligibility itself is a protected owning read, in addition to its dependencies.
  const boundary = createDecisionBoundary(config),
    auth = createRecoveryAuthorizationPort({
      capabilityCodes: config.recoveryCapabilityCodes,
      ...(config.now === undefined ? {} : { now: config.now }),
    }),
    deps = boundary.identityDeps(identityContext(row)),
    type = `execution.recovery.${consumer}.frozen_eligibility`,
    payload = { contextSnapshotRef: contextRef, workOrderContractRef: contractRef },
    key = `recovery.${consumer}.frozen_eligibility.v1`,
    target = mirror(contextRef);
  const proof = await auth.authorize(deps, key, {
    actorSnapshotRef: session.resolutionActorSnapshotRef,
    commandType: type,
    commandVersion: '1.0',
    commandPayloadHash: payloadHashOf(payload),
    authenticationContextHash: sessionAuthenticationContextHash(session),
    targetRef: target,
  });
  if (proof.outcome !== 'ALLOW') entryError('AUTHORIZATION_REVOKED', 'frozen eligibility denied');
  const revalidate = async () => {
    const result = await auth.revalidate(deps, key, {
      decisionRef: proof.authorizationDecisionRef,
      expectedCommandType: type,
      expectedCommandVersion: '1.0',
      expectedCommandPayloadHash: payloadHashOf(payload),
      expectedAuthenticationContextHash: sessionAuthenticationContextHash(session),
      expectedTargetRef: target,
    });
    if (!result.valid) entryError('AUTHORIZATION_REVOKED', 'frozen eligibility revoked');
  };
  await revalidate();
  const context: TaskExecutionTransactionContext = {
    ...identityContext(row),
    authorizationDecisionId: proof.authorizationDecisionRef.objectId,
    authorizationDecisionHash: Buffer.from(
      proof.authorizationDecisionRef.contentHash.digest,
      'hex',
    ),
    authorizationDecisionExpiresAt: new Date(proof.expiresAt),
    principalKind: row.principal_kind as TaskExecutionTransactionContext['principalKind'],
    policySnapshotId: row.policy_snapshot_id,
  };
  const result = await readFrozenContextEligibility(
    config.taskExecutionDb,
    context,
    contextRef,
    contractRef,
    {
      ...ports,
      revalidateAuthorization: async () => {
        await revalidate();
        await ports.revalidateAuthorization();
      },
      validUntil: () =>
        new Date(Math.min(Date.parse(proof.expiresAt), ports.validUntil().getTime())),
    },
  );
  await revalidate();
  return result;
}

function definedValue<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) throw new Error('REFERENCE_INVALID');
  return value;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') entryError('API_VALUE_INVALID', 'string required');
  return value;
}
