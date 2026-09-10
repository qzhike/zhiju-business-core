import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { publicApiOperations } from '../generated/public-api.js';
import { assertTaskExecutionOperationRegistrations } from '../operation-registration.js';
import { ContractRegistry } from '../registry.js';

const registry = new ContractRegistry();
const enterpriseId = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const projectId = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const workOrderId = '018f22e2-7c15-7b2e-8d86-2de956a9d204';
const principalId = '018f22e2-7c15-7b2e-8d86-2de956a9d205';
const scope = { enterpriseId, projectId };
const digest = 'a'.repeat(64);

type JsonObject = Record<string, unknown>;

function omit(object: JsonObject, key: string): JsonObject {
  return Object.fromEntries(Object.entries(object).filter(([entryKey]) => entryKey !== key));
}

function fixture(name: string): JsonObject {
  return JSON.parse(
    readFileSync(new URL(`../../../tests/fixtures/contracts/${name}`, import.meta.url), 'utf8'),
  ) as JsonObject;
}

function objectRef(
  objectType: string,
  objectId = workOrderId,
  refScope: JsonObject = scope,
): JsonObject {
  return { kind: 'OBJECT', objectType, objectId, scope: refScope };
}

function versionedRef(
  objectType: string,
  objectId = '018f22e2-7c15-7b2e-8d86-2de956a9d430',
): JsonObject {
  return {
    kind: 'VERSIONED',
    objectType,
    objectId,
    versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d431',
    scope,
  };
}

function contentRef(
  objectType: string,
  objectId = '018f22e2-7c15-7b2e-8d86-2de956a9d432',
): JsonObject {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId,
    scope,
    contentHash: {
      algorithm: 'SHA-256',
      digest,
      canonicalizationVersion: '1',
    },
  };
}

function principal(principalKind: 'HUMAN' | 'SERVICE' = 'HUMAN'): JsonObject {
  return { principalKind, principalId };
}

function workOrderDraft(): JsonObject {
  const contract = fixture('core/work-order-valid.json');
  let draft = { ...contract };
  for (const key of [
    'header',
    'workOrderRef',
    'projectRef',
    'contextSnapshotRef',
    'issuedAt',
    'expiresAt',
    'specificationHash',
  ]) {
    draft = omit(draft, key);
  }
  return draft;
}

function draftSnapshotReference(): JsonObject {
  return contentRef(
    'zhiju.execution.work_order_draft_snapshot',
    '018f22e2-7c15-7b2e-8d86-2de956a9d435',
  );
}

function initialContextRequest(withExpiry = true): JsonObject {
  return {
    draftSnapshotRef: draftSnapshotReference(),
    projectionType: 'COORDINATOR',
    purpose: 'context.initial',
    audience: principal(),
    sourceSlices: [
      contentRef('zhiju.project.context_source_slice', '018f22e2-7c15-7b2e-8d86-2de956a9d436'),
    ],
    builderPolicyRef: versionedRef('zhiju.identity.policy'),
    ...(withExpiry ? { expiresAt: '2026-09-01T00:00:00Z' } : {}),
  };
}

function commandEnvelope(
  commandType: string,
  payload: JsonObject,
  targetRef: JsonObject,
): JsonObject {
  return {
    commandId: '018f22e2-7c15-7b2e-8d86-2de956a9d437',
    commandType,
    commandVersion: '1.0',
    scopeRef: scope,
    targetRef,
    actor: objectRef('identity.principal', principalId, { enterpriseId }),
    authorizationDecisionRef: contentRef('identity.authorization_decision'),
    idempotencyKey: `fixture-${commandType}`,
    correlationId: '018f22e2-7c15-7b2e-8d86-2de956a9d438',
    requestedAt: '2026-08-17T00:00:00Z',
    payload,
    integrity: {
      canonicalizationVersion: '1',
      payloadHash: {
        algorithm: 'SHA-256',
        digest: 'c'.repeat(64),
        canonicalizationVersion: '1',
      },
    },
  };
}

function initialContextCommand(withExpiry = true): JsonObject {
  return commandEnvelope(
    'execution.build_initial_context_snapshot',
    { request: initialContextRequest(withExpiry) },
    objectRef('zhiju.execution.context_snapshot', '018f22e2-7c15-7b2e-8d86-2de956a9d439'),
  );
}

function draftQuery(): JsonObject {
  return {
    queryId: '018f22e2-7c15-7b2e-8d86-2de956a9d440',
    queryType: 'execution.get_work_order_draft',
    queryVersion: '1.0',
    scopeRef: scope,
    requester: objectRef('identity.principal', principalId, { enterpriseId }),
    authenticationContextRef: contentRef('identity.authentication_context'),
    authorizationDecisionRef: contentRef('identity.authorization_decision'),
    consistencyRequirement: 'AUTHORITATIVE',
    correlationId: '018f22e2-7c15-7b2e-8d86-2de956a9d441',
    requestedAt: '2026-08-17T00:00:00Z',
    payload: { workOrderRef: objectRef('zhiju.execution.work_order') },
  };
}

function draftQueryResult(withExpiry = true): JsonObject {
  return {
    draftSnapshotRef: draftSnapshotReference(),
    draft: workOrderDraft(),
    ...(withExpiry ? { expiresAt: '2026-09-01T00:00:00Z' } : {}),
    rootAggregateVersion: 9007199254740991,
    status: 'DRAFT',
  };
}

function frozenBuildCommand(): JsonObject {
  const request = {
    workOrderRef: objectRef('execution.work_order'),
    workOrderContractRef: contentRef('execution.work_order_contract'),
    projectionType: 'coordinator',
    purpose: 'context.retry',
    audience: objectRef('identity.principal', principalId, { enterpriseId }),
    sourceSlices: [contentRef('project.context_source_slice')],
    answeredInformationRefs: [],
    builderPolicyRef: versionedRef('identity.policy'),
  };
  return commandEnvelope(
    'execution.build_context_snapshot',
    { request },
    objectRef('execution.context_snapshot', '018f22e2-7c15-7b2e-8d86-2de956a9d442'),
  );
}

describe('TaskExecution Draft and initial Context contracts', () => {
  it('registers exactly the approved operations and reference metadata', () => {
    assertTaskExecutionOperationRegistrations(publicApiOperations);
    expect(registry.operationCount).toBe(205);
    expect(registry.getOperation('execution.get_work_order_draft', '1.0')).toMatchObject({
      owner: 'task-execution',
      kind: 'QUERY',
      allowedConsistency: ['AUTHORITATIVE'],
      authorizationPurpose: 'execution.work_order.draft.read',
    });
    expect(
      registry.getOperation('execution.get_work_order_draft', '1.0')?.payloadGuardPolicyRef,
    ).toBeUndefined();
    expect(registry.getOperation('execution.build_initial_context_snapshot', '1.0')).toMatchObject({
      owner: 'task-execution',
      kind: 'COMMAND',
      targetObjectType: 'zhiju.execution.context_snapshot',
      concurrencyMode: 'CREATE',
      authorizationPurpose: 'execution.context.build.initial',
    });
    expect(
      registry.getOperation('execution.build_initial_context_snapshot', '1.0')
        ?.payloadGuardPolicyRef,
    ).toBeUndefined();
  });

  it('accepts complete initial Context, Draft Query results with both expiry states, and frozen build', () => {
    expect(
      registry.validateOperation(
        'execution.build_initial_context_snapshot',
        '1.0',
        initialContextCommand(),
      ),
    ).toEqual({ valid: true, errors: [] });
    expect(
      registry.validateOperation('execution.get_work_order_draft', '1.0', draftQuery()),
    ).toEqual({ valid: true, errors: [] });
    expect(
      registry.validateOperationResult(
        'execution.get_work_order_draft',
        '1.0',
        draftQueryResult(true),
      ),
    ).toEqual({ valid: true, errors: [] });
    expect(
      registry.validateOperationResult(
        'execution.get_work_order_draft',
        '1.0',
        draftQueryResult(false),
      ),
    ).toEqual({ valid: true, errors: [] });
    expect(
      registry.validateOperation('execution.build_context_snapshot', '1.0', frozenBuildCommand()),
    ).toEqual({ valid: true, errors: [] });
  });

  it('keeps the initial request closed to frozen-build branches and expected CAS fields', () => {
    const wrongBranch = initialContextCommand();
    const request = (wrongBranch.payload as JsonObject).request as JsonObject;
    request.workOrderContractRef = contentRef('execution.work_order_contract');
    request.answeredInformationRefs = [];
    expect(
      registry.validateOperation('execution.build_initial_context_snapshot', '1.0', wrongBranch)
        .valid,
    ).toBe(false);

    const expectedVersion = initialContextCommand();
    expectedVersion.expectedAggregateVersion = 0;
    expect(
      registry.validateOperation('execution.build_initial_context_snapshot', '1.0', expectedVersion)
        .valid,
    ).toBe(false);
  });

  it('rejects missing, null, weak, duplicate, and empty initial refs at their public paths', () => {
    for (const field of [
      'draftSnapshotRef',
      'projectionType',
      'purpose',
      'audience',
      'sourceSlices',
      'builderPolicyRef',
    ]) {
      const input = initialContextCommand();
      const payload = input.payload as JsonObject;
      payload.request = omit(payload.request as JsonObject, field);
      const result = registry.validateOperation(
        'execution.build_initial_context_snapshot',
        '1.0',
        input,
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.instancePath === '/payload/request')).toBe(true);
    }

    const nullExpiry = initialContextCommand();
    ((nullExpiry.payload as JsonObject).request as JsonObject).expiresAt = null;
    expect(
      registry.validateOperation('execution.build_initial_context_snapshot', '1.0', nullExpiry)
        .valid,
    ).toBe(false);

    const weakDraftRef = initialContextCommand();
    const weakRequest = (weakDraftRef.payload as JsonObject).request as JsonObject;
    (weakRequest.draftSnapshotRef as JsonObject).kind = 'OBJECT';
    expect(
      registry.validateOperation('execution.build_initial_context_snapshot', '1.0', weakDraftRef)
        .valid,
    ).toBe(false);

    const missingHash = initialContextCommand();
    const missingHashRef = ((missingHash.payload as JsonObject).request as JsonObject)
      .draftSnapshotRef as JsonObject;
    delete missingHashRef.contentHash;
    expect(
      registry.validateOperation('execution.build_initial_context_snapshot', '1.0', missingHash)
        .valid,
    ).toBe(false);

    const emptySlices = initialContextCommand();
    ((emptySlices.payload as JsonObject).request as JsonObject).sourceSlices = [];
    expect(
      registry
        .validateOperation('execution.build_initial_context_snapshot', '1.0', emptySlices)
        .errors.some((error) => error.instancePath === '/payload/request/sourceSlices'),
    ).toBe(true);

    const duplicateSlices = initialContextCommand();
    const duplicateRequest = (duplicateSlices.payload as JsonObject).request as JsonObject;
    const slices = duplicateRequest.sourceSlices as JsonObject[];
    const firstSlice = slices[0];
    if (firstSlice === undefined) throw new Error('missing source slice fixture');
    slices.push(structuredClone(firstSlice));
    expect(
      registry
        .validateOperation('execution.build_initial_context_snapshot', '1.0', duplicateSlices)
        .errors.some((error) => error.instancePath === '/payload/request/sourceSlices'),
    ).toBe(true);
  });

  it('rejects invalid nested Drafts, missing/null Draft result fields, and illegal CAS values', () => {
    const invalidDraft = draftQueryResult();
    invalidDraft.draft = omit(invalidDraft.draft as JsonObject, 'objective');
    expect(
      registry.validateOperationResult('execution.get_work_order_draft', '1.0', invalidDraft).valid,
    ).toBe(false);

    for (const field of ['draftSnapshotRef', 'draft', 'rootAggregateVersion', 'status']) {
      const missing = omit(draftQueryResult(), field);
      expect(
        registry.validateOperationResult('execution.get_work_order_draft', '1.0', missing).valid,
      ).toBe(false);
    }

    const nullExpiry = draftQueryResult();
    nullExpiry.expiresAt = null;
    expect(
      registry.validateOperationResult('execution.get_work_order_draft', '1.0', nullExpiry).valid,
    ).toBe(false);

    for (const rootAggregateVersion of [-1, 1.5, '1']) {
      const invalidCas = draftQueryResult();
      invalidCas.rootAggregateVersion = rootAggregateVersion;
      expect(
        registry.validateOperationResult('execution.get_work_order_draft', '1.0', invalidCas).valid,
      ).toBe(false);
    }
  });

  it('keeps WorkOrder Draft Query exact and preserves the old frozen build ContractRef guard', () => {
    const wrongKind = draftQuery();
    ((wrongKind.payload as JsonObject).workOrderRef as JsonObject).kind = 'VERSIONED';
    expect(
      registry.validateOperation('execution.get_work_order_draft', '1.0', wrongKind).valid,
    ).toBe(false);

    const missingContractRef = frozenBuildCommand();
    const request = (missingContractRef.payload as JsonObject).request as JsonObject;
    delete request.workOrderContractRef;
    expect(
      registry.validateOperation('execution.build_context_snapshot', '1.0', missingContractRef)
        .valid,
    ).toBe(false);
  });
});
