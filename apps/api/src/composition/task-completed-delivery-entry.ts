import type { Kysely } from 'kysely';
import { ContractRegistry, type Common } from '@zhiju/contracts';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  createTaskCompletedDeliveryAuthorizationPort,
  taskCompletedDeliveryBindings,
  type TaskCompletedDeliveryAuthorizationConfig,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';
import {
  createTaskCompletedDispatchPort,
  isTaskCompletedDeliveryMaterial,
  type TaskExecutionDb,
  type TaskCompletedClaim,
  type TaskCompletedDeliveryMaterial,
} from '@zhiju/task-execution';
import {
  isCommittedDeliveryCompletionConsumption,
  createExactDeliveryCompletionConsumer,
  createDeliveryItemCompletionReadbackPort,
  handleEvaluateExactDeliveryItemCompletion,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransactionContext,
  type ExactTaskCompletionMaterial,
  type ExactDeliveryCompletionRequest,
  type CommandEnvelope,
} from '@zhiju/enterprise-project';
import {
  assertActorBinding,
  assertIntegrity,
  createDecisionBoundary,
  entryError,
  payloadHashOf,
  record,
  sessionAuthenticationContextHash,
  type IdentityBoundaryConfig,
} from './decision-boundary.js';
import type { InitialContextSession } from './initial-context-entry.js';
type Ref = CanonicalJsonObject;
export interface DeliveryCompletionSession extends InitialContextSession {
  /** Trusted authenticated session context, never transport JSON. */
  readonly identityContext: IdentityTransactionContext;
}
export interface TaskCompletedDeliveryEntryConfig extends IdentityBoundaryConfig {
  readonly taskExecutionDb: Kysely<TaskExecutionDb>;
  readonly enterpriseProjectDb: Kysely<EnterpriseProjectDb>;
  readonly authorization: TaskCompletedDeliveryAuthorizationConfig;
  readonly workerInstanceId: string;
  readonly leaseSeconds?: number;
}
export function createTaskCompletedDeliveryEntry(config: TaskCompletedDeliveryEntryConfig) {
  const registry = new ContractRegistry(),
    boundary = createDecisionBoundary(config),
    auth = createTaskCompletedDeliveryAuthorizationPort({
      ...config.authorization,
      now: config.now ?? (() => new Date()),
    }),
    now = config.now ?? (() => new Date());
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(config.workerInstanceId))
    throw new TypeError('Invalid worker instance');
  const dispatch = createTaskCompletedDispatchPort(config.taskExecutionDb, {
    ...(config.leaseSeconds ? { leaseSeconds: config.leaseSeconds } : {}),
  });
  const consumer = createExactDeliveryCompletionConsumer(config.enterpriseProjectDb, {
      assertTrustedMaterial: (value) => {
        if (!isTaskCompletedDeliveryMaterial(value))
          entryError(
            'PROJECT_DELIVERY_COMPLETION_EVENT_INVALID',
            'Material must originate from the TE owning Port',
          );
      },
    }),
    reader = createDeliveryItemCompletionReadbackPort(config.enterpriseProjectDb);
  const worker = (session: DeliveryCompletionSession) =>
    `${session.identityContext.principalId}:${config.workerInstanceId}`;
  async function authorize(
    key: string,
    target: Common.ObjectRef,
    payload: Ref,
    session: DeliveryCompletionSession,
    binding?: Ref,
  ) {
    const mapping = taskCompletedDeliveryBindings().find((b) => b.capabilityConfigKey === key);
    if (!mapping) entryError('AUTHORIZATION_DECISION_INVALID', 'Unsupported delivery boundary');
    const context = session.identityContext,
      scope = target.scope;
    if (
      !scope.enterpriseId ||
      !scope.projectId ||
      context.enterpriseId !== scope.enterpriseId ||
      !context.allowedProjectIds.includes(scope.projectId) ||
      context.actorSnapshotId !== session.resolutionActorSnapshotRef.snapshotId ||
      context.actorSnapshotId !== session.resolutionActorSnapshotRef.objectId ||
      record(session.resolutionActorSnapshotRef).kind !== 'SNAPSHOT' ||
      session.resolutionActorSnapshotRef.objectType !== 'identity.actor_snapshot'
    )
      entryError('AUTHORIZATION_DECISION_INVALID', 'Session Scope or Actor mismatch');
    const deps = boundary.identityDeps(context),
      hash = payloadHashOf(binding ?? payload),
      sessionHash = sessionAuthenticationContextHash(session);
    const issued = await auth.authorize(deps, key, {
      actorSnapshotRef: session.resolutionActorSnapshotRef,
      commandType: mapping.commandType,
      commandVersion: mapping.commandVersion,
      commandPayloadHash: hash,
      authenticationContextHash: sessionHash,
      targetRef: target,
    });
    if (issued.outcome !== 'ALLOW')
      entryError('AUTHORIZATION_DECISION_INVALID', 'Delivery authorization denied');
    const row = await boundary.readDecisionRow(issued.authorizationDecisionRef, {
      scopeKind: 'PROJECT',
      enterpriseId: scope.enterpriseId,
      projectId: scope.projectId,
    });
    assertActorBinding(session.resolutionActorSnapshotRef, row);
    const revalidate = async () => {
      const result = await auth.revalidate(deps, key, {
        decisionRef: issued.authorizationDecisionRef,
        expectedCommandType: mapping.commandType,
        expectedCommandVersion: mapping.commandVersion,
        expectedCommandPayloadHash: hash,
        expectedAuthenticationContextHash: sessionHash,
        expectedTargetRef: target,
      });
      if (!result.valid)
        entryError('AUTHORIZATION_DECISION_INVALID', 'Delivery authorization is not current');
    };
    await revalidate();
    const owningContext = {
      kind: 'REQUEST' as const,
      principalId: row.principal_id,
      principalKind: row.principal_kind as EnterpriseProjectTransactionContext['principalKind'],
      actorSnapshotId: row.actor_snapshot_id,
      authorizationDecisionId: row.authorization_decision_id,
      authorizationDecisionHash: row.payload_hash,
      authorizationDecisionExpiresAt: row.expires_at,
      policySnapshotId: row.policy_snapshot_id,
      enterpriseId: row.enterprise_id,
      allowedProjectIds: [scope.projectId],
      correlationId: context.correlationId,
    };
    return {
      context: owningContext,
      revalidate,
      decisionRef: issued.authorizationDecisionRef,
      row,
    };
  }
  function projectTarget(projectRef: Common.ObjectRef) {
    if (
      record(projectRef).kind !== 'OBJECT' ||
      projectRef.objectType !== 'zhiju.project.project' ||
      projectRef.objectId !== projectRef.scope.projectId
    )
      entryError('API_VALUE_INVALID', 'Exact Project required');
    return projectRef;
  }
  async function readProof(claim: TaskCompletedClaim, session: DeliveryCompletionSession) {
    return authorize(
      'taskCompletedReadV1',
      claim.taskRef as unknown as Common.ObjectRef,
      {
        taskRef: claim.taskRef,
        eventId: claim.eventId,
        workerOwner: worker(session),
        leaseToken: claim.leaseToken,
      },
      session,
    );
  }
  return {
    scan: async (projectRef: Common.ObjectRef, session: DeliveryCompletionSession) =>
      dispatch.scan(
        await authorize(
          'taskCompletedScanV1',
          projectTarget(projectRef),
          { projectRef: projectRef as unknown as Ref },
          session,
        ),
        projectRef.objectId,
      ),
    claim: async (
      projectRef: Common.ObjectRef,
      eventId: string,
      session: DeliveryCompletionSession,
    ) => {
      const workerOwner = worker(session),
        proof = await authorize(
          'taskCompletedClaimV1',
          projectTarget(projectRef),
          { projectRef: projectRef as unknown as Ref, eventId, workerOwner },
          session,
        );
      return dispatch.claim(
        proof,
        projectRef.objectId,
        eventId,
        workerOwner,
        (taskRef, leaseToken) =>
          authorize(
            'taskCompletedReadV1',
            taskRef as unknown as Common.ObjectRef,
            { taskRef, eventId, workerOwner, leaseToken },
            session,
          ),
      );
    },
    readClaimed: async (claim: TaskCompletedClaim, session: DeliveryCompletionSession) =>
      dispatch.readClaimed(
        await readProof(claim, session),
        String(record(claim.taskRef.scope).projectId),
        claim,
        worker(session),
      ),
    consume: async (
      material: TaskCompletedDeliveryMaterial,
      session: DeliveryCompletionSession,
    ) => {
      if (!isTaskCompletedDeliveryMaterial(material))
        entryError('PROJECT_DELIVERY_COMPLETION_EVENT_INVALID', 'Untrusted completion material');
      const scope = record(material.event.scopeRef) as unknown as Common.ScopeRef;
      const projectRef = {
        kind: 'OBJECT' as const,
        objectType: 'zhiju.project.project',
        objectId: String(scope.projectId),
        scope,
      };
      const proof = await authorize(
        'deliveryCompletionConsumeV1',
        projectRef,
        material as unknown as Ref,
        session,
      );
      return consumer.consume(
        {
          ...proof.context,
          kind: 'EVENT_CONSUMER',
          correlationId: material.event.correlationId as string,
          sourceEventId: material.event.eventId as string,
        },
        material as unknown as ExactTaskCompletionMaterial,
        proof.revalidate,
      );
    },
    confirm: async (
      claim: TaskCompletedClaim,
      material: TaskCompletedDeliveryMaterial,
      consumerResult: Ref,
      session: DeliveryCompletionSession,
    ) => {
      if (
        !isTaskCompletedDeliveryMaterial(material) ||
        !isCommittedDeliveryCompletionConsumption(consumerResult) ||
        claim.eventId !== material.event.eventId
      )
        entryError('DISPATCH_ACK_INVALID', 'Untrusted confirmation material');
      const proof = await authorize(
        'taskCompletedConfirmV1',
        claim.taskRef as unknown as Common.ObjectRef,
        {
          taskRef: claim.taskRef,
          eventId: claim.eventId,
          workerOwner: worker(session),
          leaseToken: claim.leaseToken,
          bindingHash: material.bindingHash,
          sourceWatermark: material.sourceWatermark,
          consumerResult,
        },
        session,
      );
      return dispatch.confirm(
        proof,
        String(record(claim.taskRef.scope).projectId),
        claim,
        worker(session),
        consumerResult,
      );
    },
    markFailure: async (
      claim: TaskCompletedClaim,
      errorCode: string,
      session: DeliveryCompletionSession,
    ) => {
      const proof = await authorize(
        'taskCompletedFailureV1',
        claim.taskRef as unknown as Common.ObjectRef,
        {
          taskRef: claim.taskRef,
          eventId: claim.eventId,
          workerOwner: worker(session),
          leaseToken: claim.leaseToken,
          errorCode,
        },
        session,
      );
      return dispatch.markFailure(
        proof,
        String(record(claim.taskRef.scope).projectId),
        claim,
        worker(session),
        errorCode,
      );
    },
    resumeDead: async (
      taskRef: Common.ObjectRef,
      eventId: string,
      reason: string,
      session: DeliveryCompletionSession,
    ) => {
      const proof = await authorize(
        'taskCompletedResumeV1',
        taskRef,
        { taskRef: taskRef as unknown as Ref, eventId, reason },
        session,
      );
      return dispatch.resumeDead(
        proof,
        String(taskRef.scope.projectId),
        eventId,
        taskRef.objectId,
        reason,
      );
    },
    evaluate: async (
      input: {
        commandId?: string;
        payload: ExactDeliveryCompletionRequest;
        expectedAggregateVersion: number;
        idempotencyKey: string;
        correlationId?: string;
      },
      session: DeliveryCompletionSession,
    ) => {
      const target = {
        kind: 'OBJECT' as const,
        objectType: 'zhiju.project.delivery_item',
        objectId: input.payload.deliveryItemRef.objectId,
        scope: input.payload.deliveryItemRef.scope,
      };
      const payload = input.payload as unknown as Ref;
      const actor = session.resolutionActorSnapshotRef,
        hash = payloadHashOf(payload);
      // Validate the real public Envelope before issuing a step-specific Decision.
      const partial = {
        commandId: input.commandId ?? newUuidV7(),
        commandType: 'project.evaluate_delivery_item_completion',
        commandVersion: '2.0',
        scopeRef: target.scope,
        targetRef: target,
        actor,
        authorizationDecisionRef: actor,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId ?? session.identityContext.correlationId,
        requestedAt: now().toISOString(),
        payload,
        expectedAggregateVersion: input.expectedAggregateVersion,
        integrity: {
          canonicalizationVersion: '1',
          payloadHash: {
            algorithm: 'SHA-256',
            canonicalizationVersion: '1',
            digest: hash.toString('hex'),
          },
        },
      };
      if (!registry.validateOperation(partial.commandType, partial.commandVersion, partial).valid)
        entryError('API_VALUE_INVALID', 'Invalid exact completion Envelope');
      assertIntegrity(partial.integrity, hash);
      const proof = await authorize('deliveryItemCompletionEvaluateV2', target, payload, session, {
        payload,
        expectedAggregateVersion: input.expectedAggregateVersion,
      });
      const envelope: CommandEnvelope = {
        commandId: partial.commandId,
        commandType: partial.commandType,
        commandVersion: partial.commandVersion,
        idempotencyScope: `${target.scope.enterpriseId}:${target.scope.projectId}:${target.objectId}:project.evaluate_delivery_item_completion@2.0`,
        idempotencyKey: input.idempotencyKey,
        requestPayload: payload,
        enterpriseId: proof.context.enterpriseId,
        projectId: String(target.scope.projectId),
        targetType: target.objectType,
        targetId: target.objectId,
        expectedAggregateVersion: String(input.expectedAggregateVersion),
        correlationId: partial.correlationId,
        principalId: proof.context.principalId,
        principalKind: proof.context.principalKind,
        actorSnapshotId: proof.context.actorSnapshotId,
        authorizationDecisionId: proof.context.authorizationDecisionId,
        policySnapshotId: proof.context.policySnapshotId,
      };
      return handleEvaluateExactDeliveryItemCompletion(
        config.enterpriseProjectDb,
        { ...proof.context, correlationId: partial.correlationId },
        envelope,
        { revalidate: proof.revalidate, now },
      );
    },
    readExact: async (
      request: ExactDeliveryCompletionRequest & { evaluationRef?: Common.ContentAddressedRef },
      session: DeliveryCompletionSession,
    ) => {
      const target = {
        kind: 'OBJECT' as const,
        objectType: 'zhiju.project.delivery_item',
        objectId: request.deliveryItemRef.objectId,
        scope: request.deliveryItemRef.scope,
      };
      const proof = await authorize(
        'deliveryCompletionReadExactV1',
        target,
        request as unknown as Ref,
        session,
      );
      return reader.readExact(proof.context, request, { revalidate: proof.revalidate, now });
    },
  };
}
