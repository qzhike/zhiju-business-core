import { ContractRegistry, type Common } from '@zhiju/contracts';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  createWorkOrderValidationAuthorizationPort,
  createTaskExecutionExecutionCapabilityBoundaryPort,
  type IdentityTransactionContext,
  type WorkOrderValidationCapabilityCodes,
} from '@zhiju/identity-policy';
import {
  handleValidateWorkOrderDraft,
  handleFreezeWorkOrder,
  handleGetWorkOrderContract,
  readExactWorkOrderValidation,
  readWorkOrderValidationContextMetadata,
  type CommandEnvelope,
  type TaskExecutionTransactionContext,
  type WorkOrderValidationPorts,
  type WorkOrderPolicyObservation,
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
  type RequestScope,
} from './decision-boundary.js';
import type { InitialContextEntryConfig, InitialContextSession } from './initial-context-entry.js';
import { createWorkOrderDependencyReads } from './work-order-dependency-reads.js';

export interface WorkOrderValidationEntryConfig extends Omit<
  InitialContextEntryConfig,
  'capabilityCodes'
> {
  readonly capabilityCodes: WorkOrderValidationCapabilityCodes;
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
    allowedProjectIds: row.project_id === null ? [] : [row.project_id],
    correlationId: row.authorization_decision_id,
  };
}
function requireValid(result: { readonly valid: boolean; readonly reason?: string }) {
  if (!result.valid)
    entryError(
      result.reason === 'EXPIRED' ? 'AUTHORIZATION_EXPIRED' : 'AUTHORIZATION_REVOKED',
      'WorkOrder authorization is no longer current',
    );
}
export function createWorkOrderValidationEntry(config: WorkOrderValidationEntryConfig) {
  const registry = new ContractRegistry(),
    boundary = createDecisionBoundary(config),
    now = config.now ?? (() => new Date());
  const auth = createWorkOrderValidationAuthorizationPort({
    capabilityCodes: config.capabilityCodes,
    now,
  });
  async function prepare(
    value: unknown,
    session: InitialContextSession,
    operation: 'validate' | 'freeze' | 'read',
  ) {
    const envelope = record(structuredClone(value));
    const type =
      operation === 'validate'
        ? 'execution.validate_work_order_draft'
        : operation === 'freeze'
          ? 'execution.freeze_work_order'
          : 'execution.get_work_order_contract';
    if (
      (operation === 'read' ? envelope.queryType : envelope.commandType) !== type ||
      (operation === 'read' ? envelope.queryVersion : envelope.commandVersion) !== '1.0'
    )
      entryError('API_CONTRACT_TYPE_UNKNOWN', 'unsupported WorkOrder operation');
    if (!registry.validateOperation(type, '1.0', envelope).valid)
      entryError('API_VALUE_INVALID', 'invalid WorkOrder envelope');
    const payload = record(envelope.payload) as CanonicalJsonObject,
      payloadHash = payloadHashOf(payload),
      sessionHash = sessionAuthenticationContextHash(session);
    if (operation !== 'read') assertIntegrity(envelope.integrity, payloadHash);
    else if (
      envelope.consistencyRequirement !== 'AUTHORITATIVE' ||
      record(record(envelope.authenticationContextRef).contentHash).digest !==
        sessionHash.toString('hex')
    )
      entryError('AUTHORIZATION_DECISION_INVALID', 'query authentication or consistency mismatch');
    const rawScope = record(envelope.scopeRef);
    if (typeof rawScope.enterpriseId !== 'string' || typeof rawScope.projectId !== 'string')
      entryError('SCOPE_MISMATCH', 'Project scope required');
    const scope: RequestScope = {
      scopeKind: 'PROJECT',
      enterpriseId: rawScope.enterpriseId,
      projectId: rawScope.projectId,
    };
    const ref = decisionReference(envelope.authorizationDecisionRef),
      row = await boundary.readDecisionRow(ref, scope);
    assertActorBinding(operation === 'read' ? envelope.requester : envelope.actor, row);
    assertActorBinding(session.resolutionActorSnapshotRef, row);
    if (operation !== 'read' && row.principal_kind !== 'SERVICE')
      entryError('AUTHORIZATION_DECISION_INVALID', 'authenticated Service required');
    const deps = boundary.identityDeps(identityContext(row));
    const target = (
      operation === 'read' ? payload.workOrderRef : envelope.targetRef
    ) as Common.ObjectRef;
    const revalidation = {
      decisionRef: ref,
      expectedCommandType: type,
      expectedCommandVersion: '1.0',
      expectedCommandPayloadHash: payloadHash,
      expectedAuthenticationContextHash: sessionHash,
    };
    const revalidateOwn = async () => {
      requireValid(
        await (
          operation === 'validate'
            ? auth.revalidateWorkOrderValidation.bind(auth)
            : operation === 'freeze'
              ? auth.revalidateWorkOrderFreeze.bind(auth)
              : auth.revalidateWorkOrderContractRead.bind(auth)
        )(deps, { ...revalidation, expectedTargetRef: target }),
      );
    };
    await revalidateOwn();
    const context: TaskExecutionTransactionContext = {
      ...identityContext(row),
      principalKind: row.principal_kind as TaskExecutionTransactionContext['principalKind'],
      policySnapshotId: row.policy_snapshot_id,
      correlationId: String(envelope.correlationId),
    };
    return {
      envelope,
      payload,
      payloadHash,
      sessionHash,
      scope,
      row,
      ref,
      deps,
      target,
      revalidation,
      revalidateOwn,
      context,
      type,
    };
  }
  async function command(
    value: unknown,
    session: InitialContextSession,
    operation: 'validate' | 'freeze',
  ) {
    const prepared = await prepare(value, session, operation);
    const {
      envelope,
      payload,
      payloadHash,
      sessionHash,
      scope,
      row,
      ref,
      deps,
      target,
      revalidation,
      revalidateOwn,
      context,
      type,
    } = prepared;
    const candidate = record(
      operation === 'validate' ? payload.candidateContract : payload.workOrderContract,
    );
    // Freeze has no public Draft Ref: its own Decision permits this one exact,
    // read-only judgment lookup before either dependency authorization is minted.
    const judgment =
      operation === 'freeze'
        ? await readExactWorkOrderValidation(
            config.taskExecutionDb,
            context,
            payload.validationSnapshotRef as CanonicalJsonObject,
            candidate.workOrderRef as CanonicalJsonObject,
          )
        : undefined;
    const draftRef = (judgment === undefined
      ? payload.draftSnapshotRef
      : judgment.draftSnapshotRef) as unknown as Common.ContentAddressedRef;
    const contextRef = candidate.contextSnapshotRef as Common.SnapshotRef;
    const common = {
      actorSnapshotRef: session.resolutionActorSnapshotRef,
      commandType: type,
      commandVersion: '1.0',
      commandPayloadHash: payloadHash,
      authenticationContextHash: sessionHash,
    };
    const draftDecision = await (
      operation === 'validate'
        ? auth.authorizeValidationDraftRead.bind(auth)
        : auth.authorizeFreezeDraftRead.bind(auth)
    )(deps, { ...common, draftSnapshotRef: draftRef });
    if (
      draftDecision.outcome !== 'ALLOW' ||
      draftDecision.authorizationDecisionRef === undefined ||
      draftDecision.expiresAt === undefined
    )
      entryError('AUTHORIZATION_REVOKED', 'Draft dependency read denied');
    const draftDecisionRef = draftDecision.authorizationDecisionRef;
    const draftExpiry = draftDecision.expiresAt;
    const revalidateDraft = async () => {
      requireValid(
        await (
          operation === 'validate'
            ? auth.revalidateValidationDraftRead.bind(auth)
            : auth.revalidateFreezeDraftRead.bind(auth)
        )(deps, {
          ...revalidation,
          decisionRef: draftDecisionRef,
          expectedDraftSnapshotRef: draftRef,
        }),
      );
    };
    await revalidateDraft();
    const contextDecision = await (
      operation === 'validate'
        ? auth.authorizeValidationContextRead.bind(auth)
        : auth.authorizeFreezeContextRead.bind(auth)
    )(deps, { ...common, contextSnapshotRef: contextRef });
    if (
      contextDecision.outcome !== 'ALLOW' ||
      contextDecision.authorizationDecisionRef === undefined ||
      contextDecision.expiresAt === undefined
    )
      entryError('AUTHORIZATION_REVOKED', 'Context dependency read denied');
    const contextDecisionRef = contextDecision.authorizationDecisionRef;
    const contextExpiry = contextDecision.expiresAt;
    const revalidateContext = async () => {
      requireValid(
        await (
          operation === 'validate'
            ? auth.revalidateValidationContextRead.bind(auth)
            : auth.revalidateFreezeContextRead.bind(auth)
        )(deps, {
          ...revalidation,
          decisionRef: contextDecisionRef,
          expectedContextSnapshotRef: contextRef,
        }),
      );
    };
    await revalidateContext();
    const readers = createWorkOrderDependencyReads(config, row, session);
    const preflight = async () => {
      await revalidateOwn();
      await revalidateDraft();
      await revalidateContext();
    };
    const metadata = await readWorkOrderValidationContextMetadata(
      config.taskExecutionDb,
      context,
      draftRef as unknown as CanonicalJsonObject,
      contextRef as unknown as CanonicalJsonObject,
      preflight,
    );
    for (const policyRef of [
      judgment === undefined ? payload.policyRef : judgment.policyRef,
      record(candidate.versionPins).contextBuilderPolicyRef,
      record(candidate.versionPins).capabilityPolicyRef,
    ])
      await readers.resolvePolicy(policyRef as CanonicalJsonObject);
    if (!Array.isArray(metadata.sliceRefs))
      entryError('REFERENCE_INVALID', 'missing Context source inventory');
    for (const sourceSliceRef of metadata.sliceRefs)
      await readers.slices.getContextSourceSlice({
        sourceSliceRef: sourceSliceRef as CanonicalJsonObject,
      });

    const classify = createTaskExecutionExecutionCapabilityBoundaryPort({
      db: config.identity.db,
      context: identityContext(row),
      commandId: String(envelope.commandId),
    });
    const revalidate = async () => {
      await revalidateOwn();
      await revalidateDraft();
      await revalidateContext();
      await readers.revalidate();
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
      targetType: target.objectType,
      targetId: target.objectId,
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
    // The owning repository returns the immutable Decision creation instant;
    // this internal field is never sourced from the caller's candidate.
    const issuedAt = (row as DecisionRow & { readonly created_at: Date }).created_at;
    if (!(issuedAt instanceof Date))
      entryError('AUTHORIZATION_DECISION_INVALID', 'Decision issuance instant unavailable');
    const ports: WorkOrderValidationPorts = {
      now,
      decisionIssuedAt: issuedAt.toISOString(),
      actorSnapshotRef: session.resolutionActorSnapshotRef as unknown as CanonicalJsonObject,
      authorizationDecisionRef: ref as unknown as CanonicalJsonObject,
      draftSnapshotRef: draftRef as unknown as CanonicalJsonObject,
      contextSnapshotRef: contextRef as unknown as CanonicalJsonObject,
      decisionExpiries: () => [
        row.expires_at.toISOString(),
        draftExpiry,
        contextExpiry,
        ...readers.decisionExpiries(),
      ],
      revalidateAuthorization: revalidate,
      slices: readers.slices,
      resolvePolicy: async (policyRef) =>
        (await readers.resolvePolicy(policyRef)) as unknown as WorkOrderPolicyObservation,
      classifyCapabilities: async (declaredCapabilityTypes) =>
        (
          await classify.classifyWorkOrderExecutionCapabilities({
            commandType: type,
            commandVersion: '1.0',
            principalRef: { principalId: row.principal_id, principalKind: 'SERVICE' },
            scopeRef: { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
            declaredCapabilityTypes,
            actionAt: now().toISOString(),
          })
        ).outcome === 'VALID',
    };
    return operation === 'validate'
      ? handleValidateWorkOrderDraft(config.taskExecutionDb, context, internal, ports)
      : handleFreezeWorkOrder(config.taskExecutionDb, context, internal, ports);
  }
  return {
    validate: (envelope: unknown, session: InitialContextSession) =>
      command(envelope, session, 'validate'),
    freeze: (envelope: unknown, session: InitialContextSession) =>
      command(envelope, session, 'freeze'),
    async read(envelope: unknown, session: InitialContextSession) {
      const prepared = await prepare(envelope, session, 'read');
      const result = await handleGetWorkOrderContract(
        config.taskExecutionDb,
        prepared.context,
        prepared.payload.workOrderRef as CanonicalJsonObject,
        prepared.revalidateOwn,
      );
      const checked = registry.validateOperationResult(
        'execution.get_work_order_contract',
        '1.0',
        result,
      );
      if (!checked.valid) entryError('REFERENCE_INVALID', 'stored WorkOrder result does not close');
      return result;
    },
  };
}
