import { describe, expect, it } from 'vitest';
import type { Common, EnterpriseProject } from '@zhiju/contracts';
import {
  consumeDeliveryItemCompletionEvent,
  digestCanonicalPayload,
  handleEvaluateDeliveryItemCompletion,
  PROJECT_COMPLETION_IS_DERIVED,
  PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
  PROJECT_DELIVERY_COMPLETION_EVALUATOR_INVALID,
  type DeliveryCompletionEventEnvelope,
  type EnterpriseProjectTransactionContext,
  type EnterprisePrincipalKind,
} from '@zhiju/enterprise-project';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

const ENTERPRISE_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const PROJECT_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const OTHER_PROJECT_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d203';
const SERVICE_PRINCIPAL = 'b3b3b3b3-b3b3-73b3-83b3-b3b3b3b3b3b3';
const SERVICE_ACTOR = 'b6b6b6b6-b6b6-76b6-86b6-b6b6b6b6b6b6';
const AUTHORIZATION_DECISION = 'b7b7b7b7-b7b7-77b7-87b7-b7b7b7b7b7b7';
const POLICY_SNAPSHOT = 'b8b8b8b8-b8b8-78b8-88b8-b8b8b8b8b8b8';
const ZERO_HASH: Common.ContentHash = {
  algorithm: 'SHA-256',
  digest: '0'.repeat(64),
  canonicalizationVersion: '1',
};

function contextFor(
  kind: EnterpriseProjectTransactionContext['kind'] = 'REQUEST',
  principalKind: EnterprisePrincipalKind = 'SERVICE',
  projectId = PROJECT_ID,
  correlationId = newUuidV7(),
  sourceEventId?: string,
): EnterpriseProjectTransactionContext {
  return {
    kind,
    principalId: SERVICE_PRINCIPAL,
    principalKind,
    actorSnapshotId: SERVICE_ACTOR,
    authorizationDecisionId: AUTHORIZATION_DECISION,
    authorizationDecisionHash: Buffer.alloc(32, 0xb7),
    authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    policySnapshotId: POLICY_SNAPSHOT,
    enterpriseId: ENTERPRISE_ID,
    allowedProjectIds: [projectId],
    correlationId,
    ...(sourceEventId === undefined ? {} : { sourceEventId }),
  };
}

function objectRef(objectType: string, objectId: string, projectId = PROJECT_ID) {
  return {
    kind: 'OBJECT',
    objectType,
    objectId,
    scope: { enterpriseId: ENTERPRISE_ID, projectId },
  };
}

function versionedRef(
  objectType: string,
  objectId: string,
  versionId: string,
  projectId = PROJECT_ID,
) {
  return {
    kind: 'VERSIONED',
    objectType,
    objectId,
    versionId,
    scope: { enterpriseId: ENTERPRISE_ID, projectId },
  };
}

function contentAddressedRef(objectType: string, objectId: string, projectId = PROJECT_ID) {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId,
    immutableVersionId: objectId,
    scope: { enterpriseId: ENTERPRISE_ID, projectId },
    contentHash: ZERO_HASH,
  };
}

function completionInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deliveryPlanRef: versionedRef('DeliveryPlan', newUuidV7(), newUuidV7()),
    deliveryItemId: newUuidV7(),
    criteriaHash: ZERO_HASH,
    factRefs: [contentAddressedRef('DeliveryItemCompletionFact', newUuidV7())],
    sourceWatermarks: [
      {
        sourceModule: 'task_execution',
        partition: PROJECT_ID,
        sequence: 1,
        observedAt: '2026-08-27T00:00:00Z',
      },
    ],
    evaluatorRef: versionedRef('zhiju.quality.evaluator', newUuidV7(), newUuidV7()),
    evaluatedAt: '2026-08-27T00:00:00Z',
    ...overrides,
  };
}

function commandEnvelope(
  context: EnterpriseProjectTransactionContext,
  input: Record<string, unknown>,
): Parameters<typeof handleEvaluateDeliveryItemCompletion>[2] {
  return {
    commandId: newUuidV7(),
    commandType: 'project.evaluate_delivery_item_completion',
    commandVersion: '1.0',
    idempotencyScope: 'im03.wi12.unit',
    idempotencyKey: newUuidV7(),
    requestPayload: { input } as unknown as CanonicalJsonObject,
    enterpriseId: context.enterpriseId,
    projectId: PROJECT_ID,
    targetType: 'DeliveryItem',
    targetId: input.deliveryItemId as string,
    correlationId: context.correlationId,
    principalId: context.principalId,
    principalKind: context.principalKind,
    actorSnapshotId: context.actorSnapshotId,
    authorizationDecisionId: context.authorizationDecisionId,
    policySnapshotId: context.policySnapshotId,
    payload: { input } as unknown as EnterpriseProject.ProjectEvaluateDeliveryItemCompletionPayload,
  };
}

function taskCompletedEvent(
  context: EnterpriseProjectTransactionContext,
): DeliveryCompletionEventEnvelope {
  const payload = {
    taskRef: objectRef('execution.task', newUuidV7()),
    evaluationRef: contentAddressedRef('execution.task_evaluation', newUuidV7()),
    satisfiedFactRefs: [contentAddressedRef('execution.fact', newUuidV7())],
    completedAt: '2026-08-27T00:00:00Z',
  } as unknown as CanonicalJsonObject;
  return {
    eventId: context.sourceEventId ?? newUuidV7(),
    eventType: 'execution.TaskCompleted',
    eventVersion: '1.0',
    producerModule: 'task-execution',
    aggregateType: 'execution.task',
    aggregateId: newUuidV7(),
    aggregateVersion: 1,
    scopeRef: { enterpriseId: ENTERPRISE_ID, projectId: PROJECT_ID },
    correlationId: context.correlationId,
    causationId: newUuidV7(),
    commandId: newUuidV7(),
    actorRef: objectRef('identity.principal', newUuidV7()),
    occurredAt: '2026-08-27T00:00:00Z',
    dataClassification: 'INTERNAL',
    payload,
    integrity: {
      canonicalizationVersion: '1',
      payloadHash: {
        ...ZERO_HASH,
        digest: digestCanonicalPayload(payload).hash.toString('hex'),
      } satisfies Common.ContentHash,
    },
  };
}

describe('DeliveryItem Completion WI-12 input contracts', () => {
  it('rejects caller-supplied completion outcomes before opening a database transaction', async () => {
    const context = contextFor();
    const envelope = commandEnvelope(context, completionInput({ outcome: 'SATISFIED' }));

    await expect(
      handleEvaluateDeliveryItemCompletion(undefined as never, context, envelope),
    ).rejects.toMatchObject({ code: PROJECT_COMPLETION_IS_DERIVED });
  });

  it('requires the registered namespaced evaluator reference', async () => {
    const context = contextFor();
    const envelope = commandEnvelope(
      context,
      completionInput({
        evaluatorRef: versionedRef('Evaluator', newUuidV7(), newUuidV7()),
      }),
    );

    await expect(
      handleEvaluateDeliveryItemCompletion(undefined as never, context, envelope),
    ).rejects.toMatchObject({ code: PROJECT_DELIVERY_COMPLETION_EVALUATOR_INVALID });
  });

  it('rejects a fact reference outside the exact Plan Project scope', async () => {
    const context = contextFor();
    const envelope = commandEnvelope(
      context,
      completionInput({
        factRefs: [
          contentAddressedRef('DeliveryItemCompletionFact', newUuidV7(), OTHER_PROJECT_ID),
        ],
      }),
    );

    await expect(
      handleEvaluateDeliveryItemCompletion(undefined as never, context, envelope),
    ).rejects.toMatchObject({ code: PROJECT_DELIVERY_COMPLETION_EVENT_INVALID });
  });

  it('requires an Event Consumer Service context and an exact event contract', async () => {
    const requestContext = contextFor('REQUEST');
    await expect(
      consumeDeliveryItemCompletionEvent(undefined as never, requestContext, {
        event: taskCompletedEvent(requestContext),
        sourceWatermark: {
          sourceModule: 'task_execution',
          partition: PROJECT_ID,
          sequence: 1,
          observedAt: '2026-08-27T00:00:00Z',
        },
      }),
    ).rejects.toMatchObject({ code: PROJECT_DELIVERY_COMPLETION_EVENT_INVALID });

    const eventContext = contextFor('EVENT_CONSUMER', 'SERVICE');
    const event = taskCompletedEvent(eventContext);
    await expect(
      consumeDeliveryItemCompletionEvent(undefined as never, eventContext, {
        event,
        sourceWatermark: {
          sourceModule: 'task_execution',
          partition: PROJECT_ID,
          sequence: 1,
          observedAt: '2026-08-27T00:00:00Z',
        },
      }),
    ).rejects.toMatchObject({ code: PROJECT_DELIVERY_COMPLETION_EVENT_INVALID });
    const malformed = {
      ...event,
      eventType: 'execution.UnknownCompleted',
    } as DeliveryCompletionEventEnvelope;
    await expect(
      consumeDeliveryItemCompletionEvent(undefined as never, eventContext, {
        event: malformed,
        sourceWatermark: {
          sourceModule: 'task_execution',
          partition: PROJECT_ID,
          sequence: 1,
          observedAt: '2026-08-27T00:00:00Z',
        },
      }),
    ).rejects.toMatchObject({ code: PROJECT_DELIVERY_COMPLETION_EVENT_INVALID });
  });
});
