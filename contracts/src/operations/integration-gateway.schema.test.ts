import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { publicApiOperations } from '../generated/public-api.js';
import { ContractRegistry } from '../registry.js';
import { integrationGatewayOperationContracts } from './integration-gateway.schema.js';

function fixture(name: string): Record<string, unknown> {
  const url = new URL(`../../../tests/fixtures/contracts/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

const ENTERPRISE_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const PROJECT_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const ZERO_DIGEST = '0'.repeat(64);

function scopeRef() {
  return { enterpriseId: ENTERPRISE_ID, projectId: PROJECT_ID };
}

function objectRef(objectType: string, objectId: string) {
  return {
    kind: 'OBJECT',
    objectType,
    objectId,
    scope: { enterpriseId: ENTERPRISE_ID, projectId: PROJECT_ID },
  };
}

function contentAddressedRef(objectType: string, objectId: string, digest: string) {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId,
    scope: { enterpriseId: ENTERPRISE_ID, projectId: PROJECT_ID },
    contentHash: { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' },
  };
}

function snapshotRef(objectType: string, objectId: string, snapshotId: string, digest: string) {
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId,
    snapshotId,
    scope: { enterpriseId: ENTERPRISE_ID, projectId: PROJECT_ID },
    contentHash: { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' },
  };
}

function versionedRef(objectType: string, objectId: string, versionId: string) {
  return {
    kind: 'VERSIONED',
    objectType,
    objectId,
    versionId,
    scope: { enterpriseId: ENTERPRISE_ID, projectId: PROJECT_ID },
  };
}

function externalRef(system: string, resourceType: string, externalId: string) {
  return {
    system,
    resourceType,
    externalId,
    observedAt: '2026-08-17T00:00:00Z',
  };
}

function integrity(digest: string) {
  return {
    canonicalizationVersion: '1',
    payloadHash: { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' },
  };
}

function commandEnvelope(
  commandType: string,
  targetRef: Record<string, unknown>,
  payload: Record<string, unknown>,
  digest: string = ZERO_DIGEST,
): Record<string, unknown> {
  return {
    commandId: '018f22e2-7c15-7b2e-8d86-2de956a9d301',
    commandType,
    commandVersion: '1.0',
    scopeRef: scopeRef(),
    targetRef,
    actor: objectRef('identity.principal', '018f22e2-7c15-7b2e-8d86-2de956a9d302'),
    authorizationDecisionRef: contentAddressedRef(
      'identity.authorization_decision',
      '018f22e2-7c15-7b2e-8d86-2de956a9d303',
      '1'.repeat(64),
    ),
    idempotencyKey: `fixture-${commandType}-${digest.slice(0, 6)}`,
    correlationId: '018f22e2-7c15-7b2e-8d86-2de956a9d304',
    requestedAt: '2026-08-17T00:00:00Z',
    payload,
    integrity: integrity(digest),
  };
}

function queryEnvelope(
  queryType: string,
  payload: Record<string, unknown>,
  consistencyRequirement: 'AUTHORITATIVE' | 'SNAPSHOT_AT_LEAST' | 'PROJECTION_OK' = 'AUTHORITATIVE',
): Record<string, unknown> {
  return {
    queryId: '018f22e2-7c15-7b2e-8d86-2de956a9d305',
    queryType,
    queryVersion: '1.0',
    scopeRef: scopeRef(),
    requester: objectRef('identity.principal', '018f22e2-7c15-7b2e-8d86-2de956a9d302'),
    authenticationContextRef: objectRef(
      'identity.authentication_context',
      '018f22e2-7c15-7b2e-8d86-2de956a9d306',
    ),
    consistencyRequirement,
    correlationId: '018f22e2-7c15-7b2e-8d86-2de956a9d304',
    requestedAt: '2026-08-17T00:00:00Z',
    payload,
  };
}

function eventEnvelope(
  eventType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
  digest: string = ZERO_DIGEST,
): Record<string, unknown> {
  return {
    eventId: '018f22e2-7c15-7b2e-8d86-2de956a9d307',
    eventType,
    eventVersion: '1.0',
    producerModule: 'integration-gateway',
    aggregateType: 'integration.adapter_attempt',
    aggregateId,
    aggregateVersion: 1,
    scopeRef: scopeRef(),
    correlationId: '018f22e2-7c15-7b2e-8d86-2de956a9d304',
    causationId: '018f22e2-7c15-7b2e-8d86-2de956a9d301',
    commandId: '018f22e2-7c15-7b2e-8d86-2de956a9d301',
    actorRef: objectRef('identity.principal', '018f22e2-7c15-7b2e-8d86-2de956a9d302'),
    occurredAt: '2026-08-17T00:00:00Z',
    dataClassification: 'INTERNAL',
    payload,
    integrity: integrity(digest),
  };
}

function inboundSubmission(suffix = '010') {
  return {
    adapterCode: 'feishu.channel',
    adapterVersion: '1.0.0',
    accountExternalRef: externalRef('feishu', 'tenant', `tenant-${suffix}`),
    externalEventRef: externalRef('feishu', 'message', `om_${suffix}`),
    externalEventType: 'im.message.receive_v1',
    receivedAt: '2026-08-17T00:00:00Z',
    authenticationMetadataRef: contentAddressedRef(
      'integration.authentication_metadata',
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
      ZERO_DIGEST,
    ),
    payloadRef: 'integration/inbound/feishu/raw-payload',
    payloadHash: { algorithm: 'SHA-256', digest: ZERO_DIGEST, canonicalizationVersion: '1' },
    dataClassification: 'INTERNAL',
    transportMetadata: { headerEventId: `om_${suffix}`, challenge: 'redacted' },
  };
}

function channelBindingDefinition(suffix = '020') {
  return {
    adapterCode: 'feishu.channel',
    accountExternalRef: externalRef('feishu', 'tenant', `tenant-${suffix}`),
    channelExternalRef: externalRef('feishu', 'chat', `oc_${suffix}`),
    projectRef: objectRef('project.project', `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`),
    enterpriseRef: objectRef('enterprise.enterprise', `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`),
    purpose: 'integration.channel.binding',
    bindingPolicyRef: versionedRef(
      'policy.binding',
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
    ),
    effectivePeriod: { validFrom: '2026-08-17T00:00:00Z', validTo: '2027-08-17T00:00:00Z' },
  };
}

function feishuDeliveryRequest(suffix = '030') {
  return {
    sourceBusinessRef: objectRef('release.release', `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`),
    destinationBindingRef: objectRef(
      'integration.channel_binding',
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
    ),
    recipientRefs: [
      externalRef('feishu', 'user', `user_${suffix}`),
      externalRef('feishu', 'chat', `oc_${suffix}`),
    ],
    contentContractRef: contentAddressedRef(
      'integration.channel_content',
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
      ZERO_DIGEST,
    ),
    attachmentRefs: [
      {
        representationId: `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
        revision: contentAddressedRef(
          'artifact.artifact_revision',
          `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
          ZERO_DIGEST,
        ),
        format: 'docx',
        mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        objectStorageRef: 'integration/feishu/attachments',
        checksum: { algorithm: 'SHA-256', digest: ZERO_DIGEST, canonicalizationVersion: '1' },
        renderer: { rendererId: 'renderer.docx', rendererVersion: '1.0.0' },
        createdAt: '2026-08-17T00:00:00Z',
      },
    ],
    stableIdempotencyKey: `feishu-delivery-${suffix}`,
    requestedAt: '2026-08-17T00:00:00Z',
    deliveryPolicyRef: versionedRef(
      'policy.delivery',
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
    ),
  };
}

function runtimeDispatchRequest(suffix = '040') {
  return {
    workOrderRef: objectRef('execution.work_order', `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`),
    runRef: objectRef('execution.run', `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`),
    workOrderContractRef: contentAddressedRef(
      'core.work_order',
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
      ZERO_DIGEST,
    ),
    contextSnapshotRef: snapshotRef(
      'core.project_context',
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
      ZERO_DIGEST,
    ),
    capabilityGrantRef: contentAddressedRef(
      'integration.capability_grant_bundle',
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
      ZERO_DIGEST,
    ),
    runtimeBinding: { harnessProfile: 'codex.cli', sessionHints: ['no-persistence'] },
    stableIdempotencyKey: `runtime-dispatch-${suffix}`,
    requestedAt: '2026-08-17T00:00:00Z',
  };
}

function runtimeControlRequest(suffix = '050', includeContinuation = false) {
  return {
    runRef: objectRef('execution.run', `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`),
    runtimeAttemptRef: objectRef(
      'integration.runtime_attempt',
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
    ),
    ...(includeContinuation
      ? { continuationRef: externalRef('runtime', 'session', `session-${suffix}`) }
      : {}),
    reasonCode: 'EXECUTION_RUNTIME_RESUME_REQUIRED',
    stableIdempotencyKey: `runtime-control-${suffix}`,
    requestedAt: '2026-08-17T00:00:00Z',
  };
}

function renderRequest(suffix = '060') {
  return {
    revisionRef: contentAddressedRef(
      'artifact.artifact_revision',
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
      ZERO_DIGEST,
    ),
    canonicalContentRef: 'integration/render/source-docx',
    inputHash: { algorithm: 'SHA-256', digest: ZERO_DIGEST, canonicalizationVersion: '1' },
    outputFormat: 'pdf',
    rendererId: 'renderer.pdf',
    rendererVersion: '1.0.0',
    renderPolicyRef: versionedRef(
      'policy.render',
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
    ),
    stableIdempotencyKey: `render-${suffix}`,
    requestedAt: '2026-08-17T00:00:00Z',
  };
}

function rawReceiptSubmission(suffix = '070') {
  return {
    attemptKind: 'FEISHU_CHANNEL',
    attemptRef: objectRef(
      'integration.channel_delivery_attempt',
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
    ),
    providerReceiptRef: externalRef('feishu', 'message_receipt', `om_receipt_${suffix}`),
    receiptPayloadRef: 'integration/feishu/receipts/raw',
    receiptPayloadHash: { algorithm: 'SHA-256', digest: ZERO_DIGEST, canonicalizationVersion: '1' },
    observedOutcome: 'SUCCEEDED',
    recordedAt: '2026-08-17T00:00:00Z',
  };
}

function quarantineDefinition(suffix = '080') {
  return {
    inboundEnvelopeRef: contentAddressedRef(
      'integration.inbound_envelope',
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
      ZERO_DIGEST,
    ),
    conflictRefs: [
      contentAddressedRef(
        'integration.inbound_envelope',
        `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
        ZERO_DIGEST,
      ),
    ],
    reasonCode: 'INTEGRATION_INBOUND_PAYLOAD_HASH_MISMATCH',
    observedHashes: [{ algorithm: 'SHA-256', digest: ZERO_DIGEST, canonicalizationVersion: '1' }],
    safeDiagnostic: 'Inbound hash mismatch observed; payload quarantined for triage.',
    quarantinedAt: '2026-08-17T00:00:00Z',
  };
}

describe('integration-gateway schema', () => {
  const registry = new ContractRegistry();

  it('registers exactly 23 full integration-gateway operations with the approved kind distribution', () => {
    const integration = publicApiOperations.filter(
      (operation) => operation.owner === 'integration-gateway',
    );

    expect(integration).toHaveLength(23);
    expect(integration.filter((operation) => operation.kind === 'COMMAND')).toHaveLength(9);
    expect(integration.filter((operation) => operation.kind === 'QUERY')).toHaveLength(5);
    expect(integration.filter((operation) => operation.kind === 'EVENT')).toHaveLength(9);
    expect(Object.keys(integrationGatewayOperationContracts).sort()).toEqual(
      integration.map((operation) => operation.type).sort(),
    );
  });

  it('exposes result schemas for every integration-gateway query', () => {
    const queries = publicApiOperations.filter(
      (operation) => operation.owner === 'integration-gateway' && operation.kind === 'QUERY',
    );

    expect(queries).toHaveLength(5);
    for (const operation of queries) {
      const contract = integrationGatewayOperationContracts[operation.type];
      expect(contract?.resultSchemaRef).toBeDefined();
    }
  });

  // ===========================================================================
  // Happy-path command validation (9 commands)
  // ===========================================================================

  it('validates accept_inbound_envelope with provider event id + payload hash', () => {
    const command = commandEnvelope(
      'integration.accept_inbound_envelope',
      objectRef('integration.inbound_envelope', '018f22e2-7c15-7b2e-8d86-2de956a9d010'),
      { submission: inboundSubmission('010') },
    );
    expect(
      registry.validateOperation('integration.accept_inbound_envelope', '1.0', command),
    ).toEqual({ valid: true, errors: [] });
  });

  it('validates bind_channel_context with binding decision ref', () => {
    const command = commandEnvelope(
      'integration.bind_channel_context',
      objectRef('integration.channel_binding', '018f22e2-7c15-7b2e-8d86-2de956a9d020'),
      {
        definition: channelBindingDefinition('020'),
        bindingDecisionRef: contentAddressedRef(
          'identity.business_decision',
          '018f22e2-7c15-7b2e-8d86-2de956a9d020',
          ZERO_DIGEST,
        ),
      },
    );
    expect(registry.validateOperation('integration.bind_channel_context', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('validates request_feishu_delivery with stable idempotency key and recipient refs', () => {
    const command = commandEnvelope(
      'integration.request_feishu_delivery',
      objectRef('integration.channel_delivery_attempt', '018f22e2-7c15-7b2e-8d86-2de956a9d030'),
      { request: feishuDeliveryRequest('030') },
    );
    expect(
      registry.validateOperation('integration.request_feishu_delivery', '1.0', command),
    ).toEqual({ valid: true, errors: [] });
  });

  it('validates request_runtime_dispatch with capability grant + context snapshot', () => {
    const command = commandEnvelope(
      'integration.request_runtime_dispatch',
      objectRef('integration.runtime_attempt', '018f22e2-7c15-7b2e-8d86-2de956a9d040'),
      { request: runtimeDispatchRequest('040') },
    );
    expect(
      registry.validateOperation('integration.request_runtime_dispatch', '1.0', command),
    ).toEqual({ valid: true, errors: [] });
  });

  it('validates request_runtime_cancel without optional continuation ref', () => {
    const command = commandEnvelope(
      'integration.request_runtime_cancel',
      objectRef('integration.runtime_control_attempt', '018f22e2-7c15-7b2e-8d86-2de956a9d050'),
      { request: runtimeControlRequest('050', false) },
    );
    expect(
      registry.validateOperation('integration.request_runtime_cancel', '1.0', command),
    ).toEqual({ valid: true, errors: [] });
  });

  it('validates request_runtime_resume with required continuation ref', () => {
    const command = commandEnvelope(
      'integration.request_runtime_resume',
      objectRef('integration.runtime_control_attempt', '018f22e2-7c15-7b2e-8d86-2de956a9d051'),
      { request: runtimeControlRequest('051', true) },
    );
    expect(
      registry.validateOperation('integration.request_runtime_resume', '1.0', command),
    ).toEqual({ valid: true, errors: [] });
  });

  it('validates request_render with input hash and renderer version', () => {
    const command = commandEnvelope(
      'integration.request_render',
      objectRef('integration.render_attempt', '018f22e2-7c15-7b2e-8d86-2de956a9d060'),
      { request: renderRequest('060') },
    );
    expect(registry.validateOperation('integration.request_render', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('validates record_external_receipt as Raw External Receipt', () => {
    const command = commandEnvelope(
      'integration.record_external_receipt',
      objectRef('integration.raw_external_receipt', '018f22e2-7c15-7b2e-8d86-2de956a9d070'),
      { receipt: rawReceiptSubmission('070') },
    );
    expect(
      registry.validateOperation('integration.record_external_receipt', '1.0', command),
    ).toEqual({ valid: true, errors: [] });
  });

  it('validates quarantine_external_event with conflict refs and observed hashes', () => {
    const command = commandEnvelope(
      'integration.quarantine_external_event',
      objectRef('integration.quarantine_record', '018f22e2-7c15-7b2e-8d86-2de956a9d080'),
      { definition: quarantineDefinition('080') },
    );
    expect(
      registry.validateOperation('integration.quarantine_external_event', '1.0', command),
    ).toEqual({ valid: true, errors: [] });
  });

  // ===========================================================================
  // Query payload + Result validation (5 + 5)
  // ===========================================================================

  it('validates get_channel_binding with a ChannelBindingView result', () => {
    const query = queryEnvelope('integration.get_channel_binding', {
      bindingRef: objectRef('integration.channel_binding', '018f22e2-7c15-7b2e-8d86-2de956a9d090'),
      purpose: 'integration.channel.binding',
    });
    const resultData = {
      channelBindingRef: objectRef(
        'integration.channel_binding',
        '018f22e2-7c15-7b2e-8d86-2de956a9d090',
      ),
      aggregateVersion: 1,
      definition: channelBindingDefinition('090'),
      status: 'integration.channel_binding.active',
      resolvedPurpose: 'integration.channel.binding',
    };
    expect(registry.validateOperation('integration.get_channel_binding', '1.0', query)).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      registry.validateOperationResult('integration.get_channel_binding', '1.0', resultData),
    ).toEqual({ valid: true, errors: [] });
  });

  it('validates get_delivery_attempt with an AdapterAttemptView result', () => {
    const query = queryEnvelope('integration.get_delivery_attempt', {
      attemptRef: objectRef(
        'integration.channel_delivery_attempt',
        '018f22e2-7c15-7b2e-8d86-2de956a9d0a0',
      ),
    });
    const resultData = {
      attemptRef: objectRef(
        'integration.channel_delivery_attempt',
        '018f22e2-7c15-7b2e-8d86-2de956a9d0a0',
      ),
      adapterKind: 'FEISHU_CHANNEL',
      status: 'SUCCEEDED',
      stableIdempotencyKeyHash: {
        algorithm: 'SHA-256',
        digest: ZERO_DIGEST,
        canonicalizationVersion: '1',
      },
      requestPayloadHash: {
        algorithm: 'SHA-256',
        digest: ZERO_DIGEST,
        canonicalizationVersion: '1',
      },
      rawReceiptRef: contentAddressedRef(
        'integration.raw_external_receipt',
        '018f22e2-7c15-7b2e-8d86-2de956a9d0a1',
        ZERO_DIGEST,
      ),
      updatedAt: '2026-08-17T00:00:00Z',
    };
    expect(registry.validateOperation('integration.get_delivery_attempt', '1.0', query)).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      registry.validateOperationResult('integration.get_delivery_attempt', '1.0', resultData),
    ).toEqual({ valid: true, errors: [] });
  });

  it('validates get_runtime_attempt with an AdapterAttemptView result carrying UNKNOWN status', () => {
    const query = queryEnvelope('integration.get_runtime_attempt', {
      attemptRef: objectRef('integration.runtime_attempt', '018f22e2-7c15-7b2e-8d86-2de956a9d0b0'),
    });
    const resultData = {
      attemptRef: objectRef('integration.runtime_attempt', '018f22e2-7c15-7b2e-8d86-2de956a9d0b0'),
      adapterKind: 'RUNTIME',
      status: 'UNKNOWN',
      stableIdempotencyKeyHash: {
        algorithm: 'SHA-256',
        digest: ZERO_DIGEST,
        canonicalizationVersion: '1',
      },
      requestPayloadHash: {
        algorithm: 'SHA-256',
        digest: ZERO_DIGEST,
        canonicalizationVersion: '1',
      },
      errorCode: 'INTEGRATION_EXTERNAL_OUTCOME_UNKNOWN',
      updatedAt: '2026-08-17T00:00:00Z',
    };
    expect(registry.validateOperation('integration.get_runtime_attempt', '1.0', query)).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      registry.validateOperationResult('integration.get_runtime_attempt', '1.0', resultData),
    ).toEqual({ valid: true, errors: [] });
  });

  it('validates get_render_attempt with an AdapterAttemptView result', () => {
    const query = queryEnvelope('integration.get_render_attempt', {
      attemptRef: objectRef('integration.render_attempt', '018f22e2-7c15-7b2e-8d86-2de956a9d0c0'),
    });
    const resultData = {
      attemptRef: objectRef('integration.render_attempt', '018f22e2-7c15-7b2e-8d86-2de956a9d0c0'),
      adapterKind: 'RENDERER',
      status: 'IN_FLIGHT',
      stableIdempotencyKeyHash: {
        algorithm: 'SHA-256',
        digest: ZERO_DIGEST,
        canonicalizationVersion: '1',
      },
      requestPayloadHash: {
        algorithm: 'SHA-256',
        digest: ZERO_DIGEST,
        canonicalizationVersion: '1',
      },
      leaseExpiresAt: '2026-08-17T01:00:00Z',
      updatedAt: '2026-08-17T00:00:00Z',
    };
    expect(registry.validateOperation('integration.get_render_attempt', '1.0', query)).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      registry.validateOperationResult('integration.get_render_attempt', '1.0', resultData),
    ).toEqual({ valid: true, errors: [] });
  });

  it('validates get_adapter_health with Page<AdapterHealthView> and ValueEnvelope<Duration> latency', () => {
    const query = queryEnvelope(
      'integration.get_adapter_health',
      {
        adapterCodes: ['feishu.channel', 'renderer.pdf'],
        observedAfter: '2026-08-16T00:00:00Z',
        page: { pageSize: 50, cursor: 'cursor-health-2026-08-17-page-001' },
      },
      'PROJECTION_OK',
    );
    const resultData = {
      items: [
        {
          adapterCode: 'feishu.channel',
          adapterVersion: '1.0.0',
          observedStatus: 'HEALTHY',
          capabilityCodes: ['feishu.delivery', 'feishu.receipt'],
          observedAt: '2026-08-17T00:00:00Z',
          latency: { presence: 'PRESENT', value: 'PT2S' },
          observationRef: contentAddressedRef(
            'integration.adapter_health_observation',
            '018f22e2-7c15-7b2e-8d86-2de956a9d0d0',
            ZERO_DIGEST,
          ),
        },
      ],
      nextCursor: 'cursor-health-2026-08-17-page-002',
      snapshotAt: '2026-08-17T00:00:00Z',
      sourceWatermarks: [
        {
          sourceModule: 'integration_gateway',
          partition: 'adapter-health',
          sequence: 1,
          observedAt: '2026-08-17T00:00:00Z',
        },
      ],
    };
    expect(registry.validateOperation('integration.get_adapter_health', '1.0', query)).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      registry.validateOperationResult('integration.get_adapter_health', '1.0', resultData),
    ).toEqual({ valid: true, errors: [] });
  });

  // ===========================================================================
  // Event validation (9 events)
  // ===========================================================================

  it('validates the 9 integration-gateway public events', () => {
    const accepted = eventEnvelope(
      'integration.InboundEnvelopeAccepted',
      '018f22e2-7c15-7b2e-8d86-2de956a9d0e0',
      {
        inboundEnvelopeRef: contentAddressedRef(
          'integration.inbound_envelope',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0e0',
          ZERO_DIGEST,
        ),
        adapterCode: 'feishu.channel',
        externalEventRef: externalRef('feishu', 'message', 'om_event_001'),
        resolvedPrincipalRef: { principalKind: 'HUMAN', principalId: ENTERPRISE_ID },
        targetCommandRef: contentAddressedRef(
          'core.command_receipt',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0e1',
          ZERO_DIGEST,
        ),
      },
    );
    expect(
      registry.validateOperation('integration.InboundEnvelopeAccepted', '1.0', accepted),
    ).toEqual({ valid: true, errors: [] });

    const rejected = eventEnvelope(
      'integration.InboundEnvelopeRejected',
      '018f22e2-7c15-7b2e-8d86-2de956a9d0e2',
      {
        adapterCode: 'feishu.channel',
        externalEventRef: externalRef('feishu', 'message', 'om_event_002'),
        reasonCode: 'INTEGRATION_INBOUND_AUTHENTICATION_FAILED',
        quarantineRef: contentAddressedRef(
          'integration.quarantine_record',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0e3',
          ZERO_DIGEST,
        ),
      },
    );
    expect(
      registry.validateOperation('integration.InboundEnvelopeRejected', '1.0', rejected),
    ).toEqual({ valid: true, errors: [] });

    const answer = eventEnvelope(
      'integration.ChannelAnswerReceived',
      '018f22e2-7c15-7b2e-8d86-2de956a9d0f0',
      {
        inboundEnvelopeRef: contentAddressedRef(
          'integration.inbound_envelope',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0f0',
          ZERO_DIGEST,
        ),
        channelBindingRef: objectRef(
          'integration.channel_binding',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0f1',
        ),
        informationRequestRef: objectRef(
          'execution.information_request',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0f2',
        ),
        responderRef: { principalKind: 'HUMAN', principalId: ENTERPRISE_ID },
        normalizedAnswerRef: contentAddressedRef(
          'integration.channel_answer',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0f3',
          ZERO_DIGEST,
        ),
        sourceExternalRef: externalRef('feishu', 'card_callback', 'oc_card_callback_001'),
      },
    );
    expect(registry.validateOperation('integration.ChannelAnswerReceived', '1.0', answer)).toEqual({
      valid: true,
      errors: [],
    });

    const deliveryOk = eventEnvelope(
      'integration.ChannelDeliverySucceeded',
      '018f22e2-7c15-7b2e-8d86-2de956a9d100',
      {
        attemptRef: objectRef(
          'integration.channel_delivery_attempt',
          '018f22e2-7c15-7b2e-8d86-2de956a9d100',
        ),
        sourceBusinessRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d101'),
        destinationBindingRef: objectRef(
          'integration.channel_binding',
          '018f22e2-7c15-7b2e-8d86-2de956a9d102',
        ),
        rawReceiptRef: contentAddressedRef(
          'integration.raw_external_receipt',
          '018f22e2-7c15-7b2e-8d86-2de956a9d103',
          ZERO_DIGEST,
        ),
        occurredAt: '2026-08-17T00:00:00Z',
      },
    );
    expect(
      registry.validateOperation('integration.ChannelDeliverySucceeded', '1.0', deliveryOk),
    ).toEqual({ valid: true, errors: [] });

    const deliveryFailed = eventEnvelope(
      'integration.ChannelDeliveryFailed',
      '018f22e2-7c15-7b2e-8d86-2de956a9d110',
      {
        attemptRef: objectRef(
          'integration.channel_delivery_attempt',
          '018f22e2-7c15-7b2e-8d86-2de956a9d110',
        ),
        sourceBusinessRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d111'),
        outcome: 'UNKNOWN',
        reasonCode: 'INTEGRATION_EXTERNAL_OUTCOME_UNKNOWN',
      },
    );
    expect(
      registry.validateOperation('integration.ChannelDeliveryFailed', '1.0', deliveryFailed),
    ).toEqual({ valid: true, errors: [] });

    const runtimeOk = eventEnvelope(
      'integration.RuntimeDispatchSucceeded',
      '018f22e2-7c15-7b2e-8d86-2de956a9d120',
      {
        attemptRef: objectRef(
          'integration.runtime_attempt',
          '018f22e2-7c15-7b2e-8d86-2de956a9d120',
        ),
        workOrderRef: objectRef('execution.work_order', '018f22e2-7c15-7b2e-8d86-2de956a9d121'),
        runRef: objectRef('execution.run', '018f22e2-7c15-7b2e-8d86-2de956a9d122'),
        runtimeSessionRef: externalRef('runtime', 'session', 'session-001'),
        rawReceiptRef: contentAddressedRef(
          'integration.raw_external_receipt',
          '018f22e2-7c15-7b2e-8d86-2de956a9d123',
          ZERO_DIGEST,
        ),
      },
    );
    expect(
      registry.validateOperation('integration.RuntimeDispatchSucceeded', '1.0', runtimeOk),
    ).toEqual({ valid: true, errors: [] });

    const runtimeFailed = eventEnvelope(
      'integration.RuntimeDispatchFailed',
      '018f22e2-7c15-7b2e-8d86-2de956a9d130',
      {
        attemptRef: objectRef(
          'integration.runtime_attempt',
          '018f22e2-7c15-7b2e-8d86-2de956a9d130',
        ),
        workOrderRef: objectRef('execution.work_order', '018f22e2-7c15-7b2e-8d86-2de956a9d131'),
        runRef: objectRef('execution.run', '018f22e2-7c15-7b2e-8d86-2de956a9d132'),
        outcome: 'UNKNOWN',
        reasonCode: 'INTEGRATION_RUNTIME_RESULT_LATE',
      },
    );
    expect(
      registry.validateOperation('integration.RuntimeDispatchFailed', '1.0', runtimeFailed),
    ).toEqual({ valid: true, errors: [] });

    const renderOk = eventEnvelope(
      'integration.RenderSucceeded',
      '018f22e2-7c15-7b2e-8d86-2de956a9d140',
      {
        attemptRef: objectRef('integration.render_attempt', '018f22e2-7c15-7b2e-8d86-2de956a9d140'),
        revisionRef: contentAddressedRef(
          'artifact.artifact_revision',
          '018f22e2-7c15-7b2e-8d86-2de956a9d141',
          ZERO_DIGEST,
        ),
        outputObjectRef: 'integration/render/output/pdf',
        outputChecksum: { algorithm: 'SHA-256', digest: ZERO_DIGEST, canonicalizationVersion: '1' },
        rendererId: 'renderer.pdf',
        rendererVersion: '1.0.0',
        rawReceiptRef: contentAddressedRef(
          'integration.raw_external_receipt',
          '018f22e2-7c15-7b2e-8d86-2de956a9d142',
          ZERO_DIGEST,
        ),
      },
    );
    expect(registry.validateOperation('integration.RenderSucceeded', '1.0', renderOk)).toEqual({
      valid: true,
      errors: [],
    });

    const renderFailed = eventEnvelope(
      'integration.RenderFailed',
      '018f22e2-7c15-7b2e-8d86-2de956a9d150',
      {
        attemptRef: objectRef('integration.render_attempt', '018f22e2-7c15-7b2e-8d86-2de956a9d150'),
        revisionRef: contentAddressedRef(
          'artifact.artifact_revision',
          '018f22e2-7c15-7b2e-8d86-2de956a9d151',
          ZERO_DIGEST,
        ),
        outcome: 'FAILED',
        reasonCode: 'INTEGRATION_RENDER_INPUT_MISMATCH',
        rendererId: 'renderer.pdf',
        rendererVersion: '1.0.0',
      },
    );
    expect(registry.validateOperation('integration.RenderFailed', '1.0', renderFailed)).toEqual({
      valid: true,
      errors: [],
    });
  });

  // ===========================================================================
  // Negative scenarios using disk fixtures
  // ===========================================================================

  it('rejects an inbound envelope submission that smuggles a duplicate-impersonation field through closure)', () => {
    // Closure test only: InboundEnvelopeSubmission carries additionalProperties=false,
    // so the Schema layer refuses a `duplicateOfSubmissionRef` smuggling attempt.
    // The authoritative same-id + same-hash idempotent acceptance and same-id +
    // different-hash Quarantine judgement are runtime concerns (IG-API-U-001 /
    // IG-API-U-002) and remain NOT RUN until the Handler + Repository are
    // implemented. This fixture must not be cited as duplicate acceptance.
    const command = fixture('integration-accept-inbound-envelope-command-duplicate-hash.json');
    const result = registry.validateOperation(
      'integration.accept_inbound_envelope',
      '1.0',
      command,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'additionalProperties')).toBe(true);
  });

  it('rejects a ChannelDeliveryFailed event that smuggles a webhook body alongside the outcome', () => {
    const event = fixture('integration-channel-delivery-failed-event-webhook-body-leak.json');
    const result = registry.validateOperation('integration.ChannelDeliveryFailed', '1.0', event);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'additionalProperties')).toBe(true);
  });

  it('rejects a RenderSucceeded event carrying a presigned download URL', () => {
    const event = fixture('integration-render-succeeded-event-presigned-url.json');
    const result = registry.validateOperation('integration.RenderSucceeded', '1.0', event);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'additionalProperties')).toBe(true);
  });

  it('rejects an InboundEnvelopeAccepted event that leaks an access token', () => {
    const event = fixture('integration-inbound-envelope-accepted-event-access-token-leak.json');
    const result = registry.validateOperation('integration.InboundEnvelopeAccepted', '1.0', event);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'additionalProperties')).toBe(true);
  });

  it('rejects a record_external_receipt submission whose observedOutcome is neither SUCCEEDED / FAILED / UNKNOWN', () => {
    const command = fixture(
      'integration-record-external-receipt-command-illegal-observed-outcome.json',
    );
    const result = registry.validateOperation(
      'integration.record_external_receipt',
      '1.0',
      command,
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) => error.keyword === 'enum' && error.instancePath.includes('observedOutcome'),
      ),
    ).toBe(true);
  });

  it('rejects a quarantine_external_event submission whose observedHashes is empty', () => {
    const command = fixture(
      'integration-quarantine-external-event-command-missing-observed-hashes.json',
    );
    const result = registry.validateOperation(
      'integration.quarantine_external_event',
      '1.0',
      command,
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.keyword === 'required' &&
          error.instancePath === '/payload/definition' &&
          (error.params as { missingProperty?: string }).missingProperty === 'observedHashes',
      ),
    ).toBe(true);
  });

  it('rejects a request_runtime_resume submission whose continuationRef is absent', () => {
    // Module-Spec-007 §3 requires resume to carry continuationRef; cancel is
    // intentionally allowed to omit it. The Schema overlay keeps cancel loose.
    const command = fixture('integration-request-runtime-resume-command-missing-continuation.json');
    const result = registry.validateOperation('integration.request_runtime_resume', '1.0', command);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.keyword === 'required' &&
          error.instancePath === '/payload/request' &&
          (error.params as { missingProperty?: string }).missingProperty === 'continuationRef',
      ),
    ).toBe(true);
  });

  it('accepts a request_runtime_cancel submission without continuationRef', () => {
    // Module-Spec-007 §3 makes cancel optional; the same payload shape must
    // pass validation here but fail when used as the resume request above.
    const command = fixture('integration-request-runtime-resume-command-missing-continuation.json');
    // rewrite target so the same fixture is replayed under the cancel operation
    command.commandType = 'integration.request_runtime_cancel';
    command.targetRef = {
      kind: 'OBJECT',
      objectType: 'integration.runtime_control_attempt',
      objectId: '018f22e2-7c15-7b2e-8d86-2de956a9dc02',
      scope: {
        enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d201',
        projectId: '018f22e2-7c15-7b2e-8d86-2de956a9d202',
      },
    };
    const result = registry.validateOperation('integration.request_runtime_cancel', '1.0', command);
    expect(result.valid).toBe(true);
  });

  it('rejects a request_feishu_delivery submission with deliveryMode=REPLY but missing replyToExternalRef', () => {
    // Module-Spec-007 §2 (line 115) and Feishu Channel Contract §9.2 require
    // REPLY and REPLY_IN_THREAD to always carry a replyToExternalRef. The
    // same-Binding invariant is verified by the runtime adapter.
    const command = fixture(
      'integration-request-feishu-delivery-command-reply-missing-reply-to.json',
    );
    const result = registry.validateOperation(
      'integration.request_feishu_delivery',
      '1.0',
      command,
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.keyword === 'required' &&
          error.instancePath === '/payload/request' &&
          (error.params as { missingProperty?: string }).missingProperty === 'replyToExternalRef',
      ),
    ).toBe(true);
  });

  it('rejects a request_feishu_delivery submission with deliveryMode=REPLY_IN_THREAD but missing replyToExternalRef', () => {
    const command = fixture(
      'integration-request-feishu-delivery-command-reply-in-thread-missing-reply-to.json',
    );
    const result = registry.validateOperation(
      'integration.request_feishu_delivery',
      '1.0',
      command,
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.keyword === 'required' &&
          error.instancePath === '/payload/request' &&
          (error.params as { missingProperty?: string }).missingProperty === 'replyToExternalRef',
      ),
    ).toBe(true);
  });

  it('accepts a request_feishu_delivery submission with deliveryMode=NEW_MESSAGE without replyToExternalRef', () => {
    // The if/then overlay must only constrain REPLY / REPLY_IN_THREAD;
    // NEW_MESSAGE is allowed to omit replyToExternalRef.
    const command = fixture(
      'integration-request-feishu-delivery-command-reply-missing-reply-to.json',
    );
    const payload = command.payload as {
      request: { deliveryMode: string };
    };
    payload.request.deliveryMode = 'NEW_MESSAGE';
    const result = registry.validateOperation(
      'integration.request_feishu_delivery',
      '1.0',
      command,
    );
    expect(result.valid).toBe(true);
  });

  it('rejects a bind_channel_context submission whose businessContextRefs carries a Feishu message ExternalRef', () => {
    // Module-Spec-007 §2 (line 113) limits businessContextRefs to same-Project
    // business references; ExternalRef, Runtime Session and workspace paths
    // are forbidden because they would otherwise be promoted from routing /
    // observation into business context.
    const command = fixture('integration-bind-channel-context-command-external-ref-leak.json');
    const result = registry.validateOperation('integration.bind_channel_context', '1.0', command);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) => error.keyword === 'oneOf' && error.instancePath.includes('businessContextRefs'),
      ),
    ).toBe(true);
  });

  it('rejects a bind_channel_context submission whose businessContextRefs carries a non-whitelisted objectType', () => {
    // Review (P1 round 2): the previous TypedReference-level fix only removed
    // ExternalRef; the four common typedReference schemas still accept any
    // objectType. Minimum input: an ObjectRef<identity.principal> must be
    // rejected because identity.principal is not an approved business type.
    const command = fixture('integration-bind-channel-context-command-external-ref-leak.json');
    const refs = (command.payload as { definition: { businessContextRefs: unknown } }).definition
      .businessContextRefs as Record<string, unknown>[];
    refs[0] = {
      kind: 'OBJECT',
      objectType: 'identity.principal',
      objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d201',
      scope: { enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d201' },
    };
    const result = registry.validateOperation('integration.bind_channel_context', '1.0', command);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.instancePath.includes('businessContextRefs') &&
          (error.keyword === 'oneOf' || error.keyword === 'enum' || error.keyword === 'const'),
      ),
    ).toBe(true);
  });

  it('accepts a bind_channel_context submission whose businessContextRefs carries an approved release.release objectType', () => {
    const command = fixture('integration-bind-channel-context-command-external-ref-leak.json');
    const refs = (command.payload as { definition: { businessContextRefs: unknown } }).definition
      .businessContextRefs as Record<string, unknown>[];
    refs[0] = {
      kind: 'OBJECT',
      objectType: 'release.release',
      objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d201',
      scope: { enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d201' },
    };
    const result = registry.validateOperation('integration.bind_channel_context', '1.0', command);
    expect(result.valid).toBe(true);
  });

  it('rejects a get_adapter_health result whose latency.value is a number instead of ISO 8601 Duration', () => {
    // Review (P1 round 2): the previous latency reference used the common
    // valueEnvelope whose `value` field is intentionally open JSON. Module-
    // Spec-007 §4 demands ValueEnvelope<Duration>; minimum input: 42 must be
    // rejected at the Schema layer.
    const result = fixture('integration-get-adapter-health-result-data-valid.json') as {
      items: Record<string, Record<string, unknown>>[];
    };
    const item = result.items[0];
    if (item === undefined) throw new Error('fixture missing items[0]');
    item.latency = {
      presence: 'PRESENT',
      value: 42,
    };
    const validation = registry.validateOperationResult(
      'integration.get_adapter_health',
      '1.0',
      result,
    );
    expect(validation.valid).toBe(false);
  });

  it('rejects a get_adapter_health result whose latency.value is not a valid ISO 8601 Duration', () => {
    const result = fixture('integration-get-adapter-health-result-data-valid.json') as {
      items: Record<string, Record<string, unknown>>[];
    };
    const item = result.items[0];
    if (item === undefined) throw new Error('fixture missing items[0]');
    item.latency = {
      presence: 'PRESENT',
      value: 'not-a-duration',
    };
    const validation = registry.validateOperationResult(
      'integration.get_adapter_health',
      '1.0',
      result,
    );
    expect(validation.valid).toBe(false);
  });
});
