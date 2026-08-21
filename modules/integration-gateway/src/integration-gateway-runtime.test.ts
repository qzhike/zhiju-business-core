import { describe, expect, it } from 'vitest';

import type { Common, IntegrationGateway } from '@zhiju/contracts';

import {
  INTEGRATION_SENSITIVE_DATA_REJECTED,
  IntegrationGatewayRuntime,
  type ExternalCallOutcome,
} from './integration-gateway-runtime.js';

const ENTERPRISE_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const PROJECT_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const PRINCIPAL_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d203';
const ZERO_DIGEST = '0'.repeat(64);
const ONE_DIGEST = '1'.repeat(64);

function scope(projectId = PROJECT_ID): Common.ScopeRef {
  return { enterpriseId: ENTERPRISE_ID, projectId };
}

function objectRef(objectType: string, objectId: string, projectId = PROJECT_ID): Common.ObjectRef {
  return { kind: 'OBJECT', objectType, objectId, scope: scope(projectId) };
}

function contentRef(
  objectType: string,
  objectId: string,
  digest = ZERO_DIGEST,
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId,
    scope: scope(),
    contentHash: hash(digest),
  };
}

function hash(digest: string): Common.ContentHash {
  return { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' };
}

function externalRef(
  resourceType: string,
  externalId: string,
  system = 'feishu',
): Common.ExternalRef {
  return {
    system,
    resourceType,
    externalId,
    observedAt: '2026-08-21T00:00:00Z',
  };
}

function inboundSubmission(
  eventId = 'om_runtime_001',
  payloadDigest = ZERO_DIGEST,
): IntegrationGateway.InboundEnvelopeSubmission {
  return {
    adapterCode: 'feishu.channel',
    adapterVersion: '1.0.0',
    accountExternalRef: externalRef('tenant', 'tenant_runtime_001'),
    externalEventRef: externalRef('message', eventId),
    externalEventType: 'im.message.receive_v1',
    receivedAt: '2026-08-21T00:00:00Z',
    authenticationMetadataRef: contentRef(
      'integration.authentication_metadata',
      '018f22e2-7c15-7b2e-8d86-2de956a9d204',
    ),
    payloadRef: 'integration/inbound/feishu/runtime',
    payloadHash: hash(payloadDigest),
    dataClassification: 'INTERNAL',
    transportMetadata: { providerEventId: eventId },
  };
}

function renderRequest(): IntegrationGateway.RenderRequest {
  return {
    revisionRef: contentRef(
      'artifact.artifact_revision',
      '018f22e2-7c15-7b2e-8d86-2de956a9d210',
      ZERO_DIGEST,
    ),
    canonicalContentRef: 'integration/render/source',
    inputHash: hash(ZERO_DIGEST),
    outputFormat: 'pdf',
    rendererId: 'renderer.pdf',
    rendererVersion: '1.0.0',
    renderPolicyRef: {
      kind: 'VERSIONED',
      objectType: 'policy.render',
      objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d211',
      versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d212',
      scope: scope(),
    },
    stableIdempotencyKey: 'render-runtime-001',
    requestedAt: '2026-08-21T00:00:00Z',
  };
}

describe('IntegrationGateway Issue #17 runtime slice', () => {
  it('IG-API-U-001: deduplicates same external event identity and hash', () => {
    const runtime = new IntegrationGatewayRuntime();
    const submission = inboundSubmission();
    const firstEnvelope = contentRef(
      'integration.inbound_envelope',
      '018f22e2-7c15-7b2e-8d86-2de956a9d220',
    );
    let dispatchCount = 0;
    const dispatchCommand = () => {
      dispatchCount += 1;
      return contentRef('integration.command_receipt', '018f22e2-7c15-7b2e-8d86-2de956a9d221');
    };

    const first = runtime.acceptInboundEnvelope({
      inboundEnvelopeRef: firstEnvelope,
      submission,
      correlationId: 'ig-u-001-first',
      dispatchCommand,
    });
    const replayOne = runtime.acceptInboundEnvelope({
      inboundEnvelopeRef: contentRef(
        'integration.inbound_envelope',
        '018f22e2-7c15-7b2e-8d86-2de956a9d222',
      ),
      submission,
      correlationId: 'ig-u-001-replay-one',
      dispatchCommand,
    });
    const replayTwo = runtime.acceptInboundEnvelope({
      inboundEnvelopeRef: contentRef(
        'integration.inbound_envelope',
        '018f22e2-7c15-7b2e-8d86-2de956a9d223',
      ),
      submission,
      correlationId: 'ig-u-001-replay-two',
      dispatchCommand,
    });

    expect(first.ok).toBe(true);
    expect(replayOne.ok).toBe(true);
    expect(replayTwo.ok).toBe(true);
    if (first.ok && replayOne.ok && replayTwo.ok) {
      expect(replayOne.disposition).toBe('IDEMPOTENT_REPLAY');
      expect(replayTwo.disposition).toBe('IDEMPOTENT_REPLAY');
      expect(replayOne.record).toBe(first.record);
      expect(replayTwo.record).toBe(first.record);
      expect(replayOne.record.inboundEnvelopeRef).toBe(firstEnvelope);
    }
    expect(dispatchCount).toBe(1);
    expect(runtime.getQuarantines()).toHaveLength(0);
  });

  it('IG-API-U-002: quarantines a different hash without replacing the first envelope', () => {
    const runtime = new IntegrationGatewayRuntime();
    const firstEnvelope = contentRef(
      'integration.inbound_envelope',
      '018f22e2-7c15-7b2e-8d86-2de956a9d230',
    );
    const first = runtime.acceptInboundEnvelope({
      inboundEnvelopeRef: firstEnvelope,
      submission: inboundSubmission('om_runtime_conflict', ZERO_DIGEST),
      correlationId: 'ig-u-002-first',
    });
    const conflict = runtime.acceptInboundEnvelope({
      inboundEnvelopeRef: contentRef(
        'integration.inbound_envelope',
        '018f22e2-7c15-7b2e-8d86-2de956a9d231',
      ),
      submission: inboundSubmission('om_runtime_conflict', ONE_DIGEST),
      correlationId: 'ig-u-002-conflict',
    });
    const replay = runtime.acceptInboundEnvelope({
      inboundEnvelopeRef: contentRef(
        'integration.inbound_envelope',
        '018f22e2-7c15-7b2e-8d86-2de956a9d232',
      ),
      submission: inboundSubmission('om_runtime_conflict', ZERO_DIGEST),
      correlationId: 'ig-u-002-replay',
    });

    expect(first.ok).toBe(true);
    expect(conflict.ok).toBe(false);
    expect(replay.ok).toBe(true);
    if (!conflict.ok) {
      expect(conflict.error.code).toBe('INTEGRATION_INBOUND_EVENT_REPLAY_CONFLICT');
      expect(conflict.quarantine.definition.reasonCode).toBe(
        'INTEGRATION_INBOUND_PAYLOAD_HASH_MISMATCH',
      );
      expect(conflict.quarantine.definition.observedHashes).toHaveLength(2);
    }
    if (first.ok && replay.ok) {
      expect(replay.disposition).toBe('IDEMPOTENT_REPLAY');
      expect(replay.record.inboundEnvelopeRef).toBe(firstEnvelope);
    }
    expect(runtime.getQuarantines()).toHaveLength(1);
  });

  it('IG-API-U-003: keeps a timed-out external attempt UNKNOWN and reuses it on replay', async () => {
    const runtime = new IntegrationGatewayRuntime();
    const attemptRef = objectRef(
      'integration.runtime_attempt',
      '018f22e2-7c15-7b2e-8d86-2de956a9d240',
    );
    let callCount = 0;
    const first = await runtime.executeExternalAttempt({
      attemptRef,
      adapterKind: 'RUNTIME',
      stableIdempotencyKey: 'runtime-timeout-001',
      requestPayloadHash: hash(ZERO_DIGEST),
      timeoutMs: 5,
      correlationId: 'ig-u-003-timeout',
      call: async () => {
        callCount += 1;
        return await new Promise<ExternalCallOutcome>(() => undefined);
      },
    });

    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.attempt.status).toBe('UNKNOWN');
      expect(first.attempt.errorCode).toBe('INTEGRATION_EXTERNAL_OUTCOME_UNKNOWN');
    }

    const replay = await runtime.executeExternalAttempt({
      attemptRef,
      adapterKind: 'RUNTIME',
      stableIdempotencyKey: 'runtime-timeout-001',
      requestPayloadHash: hash(ZERO_DIGEST),
      timeoutMs: 5,
      correlationId: 'ig-u-003-replay',
      call: () => {
        callCount += 1;
        return Promise.resolve({ outcome: 'SUCCEEDED' as const });
      },
    });

    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.disposition).toBe('IDEMPOTENT_REPLAY');
      expect(replay.attempt.status).toBe('UNKNOWN');
    }
    expect(callCount).toBe(1);
  });

  it.each([
    ['unknown Provider Major', { providerSchemaMajor: 3, requiredExtensions: [] }],
    [
      'unknown required extension',
      { providerSchemaMajor: 2, requiredExtensions: ['provider.extra'] },
    ],
  ])('IG-API-C-001: quarantines %s before command mapping', (label, contract) => {
    const runtime = new IntegrationGatewayRuntime();
    let dispatchCount = 0;
    const result = runtime.acceptInboundEnvelope({
      inboundEnvelopeRef: contentRef(
        'integration.inbound_envelope',
        label === 'unknown Provider Major'
          ? '018f22e2-7c15-7b2e-8d86-2de956a9d250'
          : '018f22e2-7c15-7b2e-8d86-2de956a9d251',
      ),
      submission: inboundSubmission(`om_${label.replaceAll(' ', '_')}`),
      contract,
      correlationId: `ig-c-001-${label}`,
      dispatchCommand: () => {
        dispatchCount += 1;
        return undefined;
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTEGRATION_INBOUND_CONTRACT_UNSUPPORTED');
      expect(result.quarantine.definition.safeDiagnostic).not.toContain('provider.extra');
    }
    expect(dispatchCount).toBe(0);
    expect(runtime.getQuarantines()).toHaveLength(1);
  });

  it('IG-API-C-002: rejects a RenderSucceeded observation whose input does not match the request', () => {
    const runtime = new IntegrationGatewayRuntime();
    const request = renderRequest();
    let representationRegistrationCount = 0;
    const result = runtime.validateRenderResult({
      request,
      result: {
        revisionRef: request.revisionRef,
        inputHash: hash(ONE_DIGEST),
        rendererId: request.rendererId,
        rendererVersion: request.rendererVersion,
      },
      correlationId: 'ig-c-002-mismatch',
    });

    if (result.ok) {
      representationRegistrationCount += 1;
    }
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTEGRATION_RENDER_INPUT_MISMATCH');
      expect(result.error.fieldViolations[0]?.fieldPath).toBe('/result/inputHash');
    }
    expect(representationRegistrationCount).toBe(0);
    for (const revisionRef of [
      { ...request.revisionRef, contentHash: hash(ONE_DIGEST) },
      {
        ...request.revisionRef,
        immutableVersionId: '018f22e2-7c15-7b2e-8d86-2de956a9d213',
      },
    ]) {
      const revisionMismatch = runtime.validateRenderResult({
        request,
        result: {
          revisionRef,
          inputHash: request.inputHash,
          rendererId: request.rendererId,
          rendererVersion: request.rendererVersion,
        },
        correlationId: 'ig-c-002-revision-mismatch',
      });
      expect(revisionMismatch.ok).toBe(false);
      if (!revisionMismatch.ok) {
        expect(revisionMismatch.error.code).toBe('INTEGRATION_RENDER_INPUT_MISMATCH');
      }
    }
    expect(
      runtime.validateRenderResult({
        request,
        result: {
          revisionRef: request.revisionRef,
          inputHash: request.inputHash,
          rendererId: request.rendererId,
          rendererVersion: request.rendererVersion,
        },
        correlationId: 'ig-c-002-valid',
      }).ok,
    ).toBe(true);
  });

  it('IG-API-U-004: marks an origin withdrawn while retaining receive and recall envelopes', () => {
    const runtime = new IntegrationGatewayRuntime();
    const receiveEnvelope = contentRef(
      'integration.inbound_envelope',
      '018f22e2-7c15-7b2e-8d86-2de956a9d260',
    );
    const recallEnvelope = contentRef(
      'integration.inbound_envelope',
      '018f22e2-7c15-7b2e-8d86-2de956a9d261',
    );
    const messageRef = externalRef('message', 'om_runtime_recall');

    const receive = runtime.acceptInboundEnvelope({
      inboundEnvelopeRef: receiveEnvelope,
      submission: inboundSubmission('om_runtime_recall'),
      correlationId: 'ig-u-004-receive',
    });
    const recallSubmission: IntegrationGateway.InboundEnvelopeSubmission = {
      ...inboundSubmission('evt_runtime_recall'),
      externalEventType: 'im.message.recalled_v1',
      occurredAt: '2026-08-21T00:01:00Z',
      externalEventRef: externalRef('event', 'evt_runtime_recall'),
    };
    const recall = runtime.acceptInboundEnvelope({
      inboundEnvelopeRef: recallEnvelope,
      submission: recallSubmission,
      recalledMessageRef: messageRef,
      correlationId: 'ig-u-004-recall',
    });
    const afterLateReceive = runtime.recordMessageReceived(messageRef, receiveEnvelope);

    expect(receive.ok).toBe(true);
    expect(recall.ok).toBe(true);

    const origin = runtime.getMessageOrigin(messageRef);
    expect(origin?.status).toBe('WITHDRAWN');
    expect(origin?.sourceEnvelopeRefs).toEqual([receiveEnvelope, recallEnvelope]);
    expect(afterLateReceive.status).toBe('WITHDRAWN');
    expect(afterLateReceive.sourceEnvelopeRefs).toEqual([receiveEnvelope, recallEnvelope]);
    expect(origin?.sourceEnvelopeRefs).toContain(receiveEnvelope);
  });

  it('IG-API-U-005: requires explicit authorization after binding scope resolution', () => {
    let authorizationCalls = 0;
    const runtime = new IntegrationGatewayRuntime({
      authorizationPort: {
        authorize: () => {
          authorizationCalls += 1;
          return false;
        },
      },
    });
    const bindingRef = objectRef(
      'integration.channel_binding',
      '018f22e2-7c15-7b2e-8d86-2de956a9d270',
    );
    runtime.registerChannelBinding({ bindingRef, scope: scope(PROJECT_ID) });

    const denied = runtime.authorizeChannelAction({
      bindingRef,
      principalRef: { principalKind: 'HUMAN', principalId: PRINCIPAL_ID },
      targetScope: scope(PROJECT_ID),
      correlationId: 'ig-u-005-denied',
    });
    const foreignScope = runtime.authorizeChannelAction({
      bindingRef,
      principalRef: { principalKind: 'HUMAN', principalId: PRINCIPAL_ID },
      targetScope: scope('018f22e2-7c15-7b2e-8d86-2de956a9d299'),
      correlationId: 'ig-u-005-foreign-scope',
    });

    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error.code).toBe('INTEGRATION_CHANNEL_MEMBER_NOT_AUTHORIZED');
    }
    expect(foreignScope.ok).toBe(false);
    if (!foreignScope.ok) {
      expect(foreignScope.error.code).toBe('INTEGRATION_CHANNEL_BINDING_SCOPE_MISMATCH');
    }
    expect(authorizationCalls).toBe(1);
  });

  it('IG-API-U-006: rejects access token, app secret and webhook body from audit input', () => {
    const runtime = new IntegrationGatewayRuntime();
    const sensitiveInputs = [
      { access_token: 'token-value' },
      { appSecret: 'secret-value' },
      { rawWebhookBody: '{"message":"private"}' },
    ];

    for (const [index, metadata] of sensitiveInputs.entries()) {
      const result = runtime.recordAudit({
        correlationId: `ig-u-006-sensitive-${String(index)}`,
        eventCode: 'INTEGRATION_INBOUND_AUTHENTICATION_FAILED',
        diagnosticHash: hash(String(index + 2).repeat(64)),
        metadata,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(INTEGRATION_SENSITIVE_DATA_REJECTED);
        expect(result.error.safeMessage).not.toContain('token-value');
        expect(result.error.safeMessage).not.toContain('secret-value');
      }
    }

    const safe = runtime.recordAudit({
      correlationId: 'ig-u-006-safe',
      eventCode: 'INTEGRATION_EXTERNAL_OUTCOME_UNKNOWN',
      diagnosticHash: hash('3'.repeat(64)),
      metadata: { adapterCode: 'feishu.channel', payloadHash: ZERO_DIGEST },
    });
    expect(safe.ok).toBe(true);
    expect(runtime.getAuditRecords()).toHaveLength(1);
    expect(runtime.getAuditRecords()[0]).not.toHaveProperty('metadata');
  });
});
