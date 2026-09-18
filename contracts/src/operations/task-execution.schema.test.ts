import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { publicApiOperations } from '../generated/public-api.js';
import {
  assertTaskExecutionOperationRegistrations,
  assertTaskReadinessOperationRegistrations,
} from '../operation-registration.js';
import { ContractRegistry, type ContractValidationResult } from '../registry.js';
import { operationSchemaDefinitionName } from '../schema-types.js';
import { taskExecutionOperationContracts } from './task-execution.schema.js';

const registry = new ContractRegistry();
const enterpriseId = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const projectId = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const workOrderId = '018f22e2-7c15-7b2e-8d86-2de956a9d204';
const principalId = '018f22e2-7c15-7b2e-8d86-2de956a9d205';
const scope = { enterpriseId, projectId };
const digest = 'a'.repeat(64);

type JsonObject = Record<string, unknown>;

function expectSchemaError(
  result: ContractValidationResult,
  instancePath: string,
  keyword: string,
  params?: Record<string, unknown>,
): void {
  expect(result.valid).toBe(false);
  expect(result.errors).toContainEqual(
    expect.objectContaining({
      instancePath,
      keyword,
      ...(params === undefined ? {} : { params: expect.objectContaining(params) }),
    }),
  );
}

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

function initialWorkOrderDraft(): JsonObject {
  const draft = workOrderDraft();
  const versionPins = { ...(draft.versionPins as JsonObject) };
  delete versionPins.projectContextContractRef;
  versionPins.contextBuilderPolicyRef = {
    ...(versionPins.contextBuilderPolicyRef as JsonObject),
    objectType: 'zhiju.identity.policy',
  };
  draft.versionPins = versionPins;
  return draft;
}

function draftSnapshotReference(): JsonObject {
  return contentRef(
    'zhiju.execution.work_order_draft_snapshot',
    '018f22e2-7c15-7b2e-8d86-2de956a9d435',
  );
}

function initialContextRequest(withExpiry = true): JsonObject {
  const request = fixture('context-build/initial-v1-1.json');
  if (!withExpiry) delete request.expiresAt;
  return request;
}

function commandEnvelope(
  commandType: string,
  payload: JsonObject,
  targetRef: JsonObject,
  version: '1.0' | '1.1' = '1.0',
): JsonObject {
  return {
    commandId: '018f22e2-7c15-7b2e-8d86-2de956a9d437',
    commandType,
    commandVersion: version,
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

function initialContextCommand(withExpiry = true, version: '1.0' | '1.1' = '1.0'): JsonObject {
  return commandEnvelope(
    'execution.build_initial_context_snapshot',
    { request: initialContextRequest(withExpiry) },
    objectRef('zhiju.execution.context_snapshot', '018f22e2-7c15-7b2e-8d86-2de956a9d439'),
    version,
  );
}

function draftQuery(version: '1.0' | '1.1' = '1.0'): JsonObject {
  return {
    queryId: '018f22e2-7c15-7b2e-8d86-2de956a9d440',
    queryType: 'execution.get_work_order_draft',
    queryVersion: version,
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

function draftQueryResult(withExpiry = true, version: '1.0' | '1.1' = '1.0'): JsonObject {
  return {
    draftSnapshotRef: draftSnapshotReference(),
    draft: version === '1.1' ? initialWorkOrderDraft() : workOrderDraft(),
    ...(withExpiry ? { expiresAt: '2026-09-01T00:00:00Z' } : {}),
    rootAggregateVersion: 9007199254740991,
    status: 'DRAFT',
  };
}

function createWorkOrderCommand(version: '1.0' | '1.1'): JsonObject {
  return commandEnvelope(
    'execution.create_work_order',
    {
      draft: version === '1.1' ? initialWorkOrderDraft() : workOrderDraft(),
      expiresAt: '2026-09-01T00:00:00Z',
    },
    objectRef('zhiju.execution.work_order'),
    version,
  );
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
    builderPolicyRef: versionedRef('zhiju.identity.policy'),
  };
  return commandEnvelope(
    'execution.build_context_snapshot',
    { request },
    objectRef('execution.context_snapshot', '018f22e2-7c15-7b2e-8d86-2de956a9d442'),
  );
}

function frozenBuildFixture(name: string): JsonObject {
  return fixture(`context-build/${name}.json`);
}

describe('TaskExecution Draft and initial Context contracts', () => {
  it('registers exactly the approved operations and reference metadata', () => {
    assertTaskExecutionOperationRegistrations(publicApiOperations);
    expect(registry.operationCount).toBe(215);
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

  it('registers and validates the additive v1.1 initial WorkOrder chain', () => {
    expect(registry.getOperation('execution.create_work_order', '1.1')).toMatchObject({
      owner: 'task-execution',
      kind: 'COMMAND',
      targetObjectType: 'zhiju.execution.work_order',
      concurrencyMode: 'CREATE',
      authorizationPurpose: 'task.execution.create_work_order',
      references: [
        {
          path: '/targetRef',
          kind: 'OBJECT',
          objectType: 'zhiju.execution.work_order',
        },
      ],
    });
    expect(registry.getOperation('execution.get_work_order_draft', '1.1')).toMatchObject({
      owner: 'task-execution',
      kind: 'QUERY',
      allowedConsistency: ['AUTHORITATIVE'],
    });
    expect(registry.getOperation('execution.build_initial_context_snapshot', '1.1')).toMatchObject({
      owner: 'task-execution',
      kind: 'COMMAND',
      targetObjectType: 'zhiju.execution.context_snapshot',
      concurrencyMode: 'CREATE',
    });

    expect(
      registry.validateOperation(
        'execution.create_work_order',
        '1.1',
        createWorkOrderCommand('1.1'),
      ),
    ).toEqual({ valid: true, errors: [] });
    expect(
      registry.validateOperation('execution.get_work_order_draft', '1.1', draftQuery('1.1')),
    ).toEqual({ valid: true, errors: [] });
    expect(
      registry.validateOperationResult(
        'execution.get_work_order_draft',
        '1.1',
        draftQueryResult(true, '1.1'),
      ),
    ).toEqual({ valid: true, errors: [] });
    expect(
      registry.validateOperation(
        'execution.build_initial_context_snapshot',
        '1.1',
        initialContextCommand(true, '1.1'),
      ),
    ).toEqual({ valid: true, errors: [] });

    const createWithCas = createWorkOrderCommand('1.1');
    createWithCas.expectedAggregateVersion = 0;
    expectSchemaError(
      registry.validateOperation('execution.create_work_order', '1.1', createWithCas),
      '/expectedAggregateVersion',
      'false schema',
    );

    const createWithWrongTarget = createWorkOrderCommand('1.1');
    createWithWrongTarget.targetRef = objectRef('zhiju.artifact.artifact');
    expectSchemaError(
      registry.validateOperation('execution.create_work_order', '1.1', createWithWrongTarget),
      '/targetRef/objectType',
      'const',
      { allowedValue: 'zhiju.execution.work_order' },
    );

    const draftWithContextRef = createWorkOrderCommand('1.1');
    const draft = (draftWithContextRef.payload as JsonObject).draft as JsonObject;
    const versionPins = draft.versionPins as JsonObject;
    versionPins.projectContextContractRef = {
      kind: 'SNAPSHOT',
      objectType: 'zhiju.project.context_snapshot',
      objectId: workOrderId,
      snapshotId: principalId,
      scope,
      contentHash: { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' },
    };
    expectSchemaError(
      registry.validateOperation('execution.create_work_order', '1.1', draftWithContextRef),
      '/payload/draft/versionPins',
      'additionalProperties',
      { additionalProperty: 'projectContextContractRef' },
    );

    const missingDraftPin = createWorkOrderCommand('1.1');
    delete ((missingDraftPin.payload as JsonObject).draft as JsonObject).versionPins;
    expectSchemaError(
      registry.validateOperation('execution.create_work_order', '1.1', missingDraftPin),
      '/payload/draft',
      'required',
      { missingProperty: 'versionPins' },
    );

    const frozenBranch = initialContextCommand(true, '1.1');
    ((frozenBranch.payload as JsonObject).request as JsonObject).workOrderContractRef = contentRef(
      'execution.work_order_contract',
    );
    expectSchemaError(
      registry.validateOperation('execution.build_initial_context_snapshot', '1.1', frozenBranch),
      '/payload/request',
      'additionalProperties',
      { additionalProperty: 'workOrderContractRef' },
    );

    // The historical @1.0 path remains valid with its original VersionPins shape.
    expect(
      registry.validateOperation(
        'execution.create_work_order',
        '1.0',
        createWorkOrderCommand('1.0'),
      ),
    ).toEqual({ valid: true, errors: [] });
  });

  it('accepts complete initial Context, Draft Query results with both expiry states, and frozen build', () => {
    expect(
      registry.validateOperation(
        'execution.build_initial_context_snapshot',
        '1.0',
        initialContextCommand(),
      ),
    ).toEqual({ valid: true, errors: [] });
    for (const pagination of [
      undefined,
      { pageSize: 1 },
      { pageSize: 1, cursor: 'a'.repeat(16) },
    ]) {
      const query = draftQuery();
      if (pagination !== undefined) query.pagination = pagination;
      expect(registry.validateOperation('execution.get_work_order_draft', '1.0', query)).toEqual({
        valid: true,
        errors: [],
      });
    }
    for (const testCase of [
      {
        pagination: {},
        instancePath: '/pagination',
        keyword: 'required',
        params: { missingProperty: 'pageSize' },
      },
      {
        pagination: { pageSize: 0 },
        instancePath: '/pagination/pageSize',
        keyword: 'minimum',
      },
      {
        pagination: { pageSize: 1.5 },
        instancePath: '/pagination/pageSize',
        keyword: 'type',
      },
      {
        pagination: { pageSize: 1, cursor: '!' },
        instancePath: '/pagination/cursor',
        keyword: 'pattern',
      },
      {
        pagination: { pageSize: 1, padding: [] },
        instancePath: '/pagination',
        keyword: 'additionalProperties',
        params: { additionalProperty: 'padding' },
      },
    ]) {
      const query = draftQuery();
      query.pagination = testCase.pagination;
      expectSchemaError(
        registry.validateOperation('execution.get_work_order_draft', '1.0', query),
        testCase.instancePath,
        testCase.keyword,
        testCase.params,
      );
    }
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

  it('accepts ordinary answeredInformationRefs arrays without changing complete fixtures', () => {
    const cases = [
      ['frozen-build-empty-answered-refs', 0],
      ['frozen-build-single-answered-ref', 1],
      ['frozen-build-duplicate-answered-ref', 2],
    ] as const;
    let requestWithoutAnsweredRefs: JsonObject | undefined;
    let integrity: unknown;

    for (const [name, expectedLength] of cases) {
      const command = frozenBuildFixture(name);
      const beforeValidation = structuredClone(command);
      const payload = command.payload as JsonObject;
      const request = payload.request as JsonObject;
      const answeredRefs = request.answeredInformationRefs as JsonObject[];

      expect(answeredRefs).toHaveLength(expectedLength);
      if (expectedLength === 2) {
        const firstRef = answeredRefs[0];
        const secondRef = answeredRefs[1];
        if (firstRef === undefined || secondRef === undefined) {
          throw new Error('missing duplicate answered reference fixture');
        }
        expect(secondRef).toEqual(firstRef);
      }

      expect(
        registry.validateOperation('execution.build_context_snapshot', '1.0', command),
      ).toEqual({ valid: true, errors: [] });
      expect(command).toEqual(beforeValidation);

      const currentRequestWithoutAnsweredRefs = omit(request, 'answeredInformationRefs');
      if (requestWithoutAnsweredRefs === undefined) {
        requestWithoutAnsweredRefs = currentRequestWithoutAnsweredRefs;
      } else {
        expect(currentRequestWithoutAnsweredRefs).toEqual(requestWithoutAnsweredRefs);
      }
      if (integrity === undefined) integrity = command.integrity;
      else expect(command.integrity).toEqual(integrity);
    }
  });

  it('keeps answered ref shape, source-slice Set, and ContractRef controls independent', () => {
    const base = frozenBuildFixture('frozen-build-single-answered-ref');

    const nonArray = structuredClone(base);
    const nonArrayRequest = (nonArray.payload as JsonObject).request as JsonObject;
    nonArrayRequest.answeredInformationRefs = {};
    expectSchemaError(
      registry.validateOperation('execution.build_context_snapshot', '1.0', nonArray),
      '/payload/request/answeredInformationRefs',
      'type',
    );

    const malformedRef = structuredClone(base);
    const malformedRequest = (malformedRef.payload as JsonObject).request as JsonObject;
    malformedRequest.answeredInformationRefs = [{}];
    expectSchemaError(
      registry.validateOperation('execution.build_context_snapshot', '1.0', malformedRef),
      '/payload/request/answeredInformationRefs/0',
      'oneOf',
    );

    const missingContractRef = structuredClone(base);
    const missingContractRequest = (missingContractRef.payload as JsonObject).request as JsonObject;
    delete missingContractRequest.workOrderContractRef;
    expectSchemaError(
      registry.validateOperation('execution.build_context_snapshot', '1.0', missingContractRef),
      '/payload/request',
      'required',
      { missingProperty: 'workOrderContractRef' },
    );

    const emptySlices = structuredClone(base);
    ((emptySlices.payload as JsonObject).request as JsonObject).sourceSlices = [];
    expectSchemaError(
      registry.validateOperation('execution.build_context_snapshot', '1.0', emptySlices),
      '/payload/request/sourceSlices',
      'minItems',
    );

    const duplicateSlices = structuredClone(base);
    const duplicateSlicesRequest = (duplicateSlices.payload as JsonObject).request as JsonObject;
    const sourceSlices = duplicateSlicesRequest.sourceSlices as JsonObject[];
    const firstSlice = sourceSlices[0];
    if (firstSlice === undefined) throw new Error('missing source slice fixture');
    sourceSlices.push(structuredClone(firstSlice));
    expectSchemaError(
      registry.validateOperation('execution.build_context_snapshot', '1.0', duplicateSlices),
      '/payload/request/sourceSlices',
      'uniqueItems',
    );
  });

  it('keeps the initial request closed to frozen-build branches and expected CAS fields', () => {
    for (const field of ['workOrderContractRef', 'answeredInformationRefs']) {
      const wrongBranch = initialContextCommand();
      const request = (wrongBranch.payload as JsonObject).request as JsonObject;
      request[field] =
        field === 'workOrderContractRef' ? contentRef('execution.work_order_contract') : [];
      expectSchemaError(
        registry.validateOperation('execution.build_initial_context_snapshot', '1.0', wrongBranch),
        '/payload/request',
        'additionalProperties',
        { additionalProperty: field },
      );
    }

    const expectedVersion = initialContextCommand();
    ((expectedVersion.payload as JsonObject).request as JsonObject).expectedAggregateVersion = 0;
    expectSchemaError(
      registry.validateOperation(
        'execution.build_initial_context_snapshot',
        '1.0',
        expectedVersion,
      ),
      '/payload/request',
      'additionalProperties',
      { additionalProperty: 'expectedAggregateVersion' },
    );
  });

  it('rejects missing, null, weak, duplicate, and empty initial refs at their public paths', () => {
    const requiredFields = [
      'draftSnapshotRef',
      'projectionType',
      'purpose',
      'audience',
      'sourceSlices',
      'builderPolicyRef',
    ] as const;
    const nullKeywords: Record<(typeof requiredFields)[number], string> = {
      draftSnapshotRef: 'type',
      projectionType: 'enum',
      purpose: 'type',
      audience: 'type',
      sourceSlices: 'type',
      builderPolicyRef: 'type',
    };

    for (const field of requiredFields) {
      const missing = initialContextCommand();
      const missingPayload = missing.payload as JsonObject;
      missingPayload.request = omit(missingPayload.request as JsonObject, field);
      expectSchemaError(
        registry.validateOperation('execution.build_initial_context_snapshot', '1.0', missing),
        '/payload/request',
        'required',
        { missingProperty: field },
      );

      const nullValue = initialContextCommand();
      ((nullValue.payload as JsonObject).request as JsonObject)[field] = null;
      expectSchemaError(
        registry.validateOperation('execution.build_initial_context_snapshot', '1.0', nullValue),
        `/payload/request/${field}`,
        nullKeywords[field],
      );
    }

    const nullExpiry = initialContextCommand();
    ((nullExpiry.payload as JsonObject).request as JsonObject).expiresAt = null;
    expectSchemaError(
      registry.validateOperation('execution.build_initial_context_snapshot', '1.0', nullExpiry),
      '/payload/request/expiresAt',
      'type',
    );

    const weakDraftRef = initialContextCommand();
    const weakRequest = (weakDraftRef.payload as JsonObject).request as JsonObject;
    (weakRequest.draftSnapshotRef as JsonObject).kind = 'OBJECT';
    expectSchemaError(
      registry.validateOperation('execution.build_initial_context_snapshot', '1.0', weakDraftRef),
      '/payload/request/draftSnapshotRef/kind',
      'const',
    );

    for (const objectType of [
      'zhiju.context.policy',
      'identity.policy',
      'policy.context_builder',
    ]) {
      const wrongPolicyNamespace = initialContextCommand();
      const request = (wrongPolicyNamespace.payload as JsonObject).request as JsonObject;
      (request.builderPolicyRef as JsonObject).objectType = objectType;
      expectSchemaError(
        registry.validateOperation(
          'execution.build_initial_context_snapshot',
          '1.0',
          wrongPolicyNamespace,
        ),
        '/payload/request/builderPolicyRef/objectType',
        'const',
        { allowedValue: 'zhiju.identity.policy' },
      );
    }

    const missingHash = initialContextCommand();
    const missingHashRef = ((missingHash.payload as JsonObject).request as JsonObject)
      .draftSnapshotRef as JsonObject;
    delete missingHashRef.contentHash;
    expectSchemaError(
      registry.validateOperation('execution.build_initial_context_snapshot', '1.0', missingHash),
      '/payload/request/draftSnapshotRef',
      'required',
      { missingProperty: 'contentHash' },
    );

    const emptySlices = initialContextCommand();
    ((emptySlices.payload as JsonObject).request as JsonObject).sourceSlices = [];
    expectSchemaError(
      registry.validateOperation('execution.build_initial_context_snapshot', '1.0', emptySlices),
      '/payload/request/sourceSlices',
      'minItems',
    );

    const duplicateSlices = initialContextCommand();
    const duplicateRequest = (duplicateSlices.payload as JsonObject).request as JsonObject;
    const slices = duplicateRequest.sourceSlices as JsonObject[];
    const firstSlice = slices[0];
    if (firstSlice === undefined) throw new Error('missing source slice fixture');
    slices.push(structuredClone(firstSlice));
    expectSchemaError(
      registry.validateOperation(
        'execution.build_initial_context_snapshot',
        '1.0',
        duplicateSlices,
      ),
      '/payload/request/sourceSlices',
      'uniqueItems',
    );
  });

  it('rejects invalid nested Drafts, missing/null Draft result fields, and illegal CAS values', () => {
    const invalidDraft = draftQueryResult();
    invalidDraft.draft = omit(invalidDraft.draft as JsonObject, 'objective');
    expectSchemaError(
      registry.validateOperationResult('execution.get_work_order_draft', '1.0', invalidDraft),
      '/draft',
      'required',
      { missingProperty: 'objective' },
    );

    for (const field of ['draftSnapshotRef', 'draft', 'rootAggregateVersion', 'status']) {
      const missing = omit(draftQueryResult(), field);
      expectSchemaError(
        registry.validateOperationResult('execution.get_work_order_draft', '1.0', missing),
        '',
        'required',
        { missingProperty: field },
      );
    }

    const nullExpiry = draftQueryResult();
    nullExpiry.expiresAt = null;
    expectSchemaError(
      registry.validateOperationResult('execution.get_work_order_draft', '1.0', nullExpiry),
      '/expiresAt',
      'type',
    );

    for (const testCase of [
      { value: -1, keyword: 'minimum' },
      { value: 1.5, keyword: 'type' },
      { value: '1', keyword: 'type' },
      { value: 9007199254740992, keyword: 'maximum' },
      { value: 1e100, keyword: 'maximum' },
    ]) {
      const invalidCas = draftQueryResult();
      invalidCas.rootAggregateVersion = testCase.value;
      expectSchemaError(
        registry.validateOperationResult('execution.get_work_order_draft', '1.0', invalidCas),
        '/rootAggregateVersion',
        testCase.keyword,
      );
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

  it('registers one executable result schema per Initial Context entry version', () => {
    const resultData = fixture('context-build/initial-context-result.json').data;

    for (const version of ['1.0', '1.1'] as const) {
      const expectedRef = `https://schemas.zhiju.local/modules/task-execution/1.0#/$defs/${operationSchemaDefinitionName(
        'execution.build_initial_context_snapshot',
        version,
        'result',
      )}`;
      const key =
        version === '1.0'
          ? 'execution.build_initial_context_snapshot'
          : `execution.build_initial_context_snapshot@${version}`;

      expect(
        registry.getOperation('execution.build_initial_context_snapshot', version)?.resultSchemaRef,
      ).toBe(expectedRef);
      expect(taskExecutionOperationContracts[key]?.resultSchemaRef).toBe(expectedRef);
      expect(
        registry.validateOperationResult(
          'execution.build_initial_context_snapshot',
          version,
          resultData,
        ),
      ).toEqual({ valid: true, errors: [] });
    }

    // The frozen build stays on its ContractRef semantics: it returns identity
    // through the envelope only and declares no operation-specific result data.
    expect(
      registry.getOperation('execution.build_context_snapshot', '1.0')?.resultSchemaRef,
    ).toBeUndefined();
  });

  it('pins the canonical Context Snapshot identity in the Initial Context result schema', () => {
    const resultData = (): JsonObject =>
      fixture('context-build/initial-context-result.json').data as JsonObject;

    function snapshotRef(data: JsonObject): JsonObject {
      return data.contextSnapshotRef as JsonObject;
    }

    const missingRef = resultData();
    delete missingRef.contextSnapshotRef;
    expectSchemaError(
      registry.validateOperationResult(
        'execution.build_initial_context_snapshot',
        '1.0',
        missingRef,
      ),
      '',
      'required',
      { missingProperty: 'contextSnapshotRef' },
    );

    for (const objectType of ['zhiju.project.context_snapshot', 'zhiju.execution.other_snapshot']) {
      const wrongIdentity = resultData();
      snapshotRef(wrongIdentity).objectType = objectType;
      expectSchemaError(
        registry.validateOperationResult(
          'execution.build_initial_context_snapshot',
          '1.0',
          wrongIdentity,
        ),
        '/contextSnapshotRef/objectType',
        'const',
        { allowedValue: 'zhiju.execution.context_snapshot' },
      );
    }

    const wrongKind = resultData();
    snapshotRef(wrongKind).kind = 'OBJECT';
    expectSchemaError(
      registry.validateOperationResult(
        'execution.build_initial_context_snapshot',
        '1.0',
        wrongKind,
      ),
      '/contextSnapshotRef/kind',
      'const',
      { allowedValue: 'SNAPSHOT' },
    );

    const wrongHash = resultData();
    (snapshotRef(wrongHash).contentHash as JsonObject).digest = 'zz';
    expectSchemaError(
      registry.validateOperationResult(
        'execution.build_initial_context_snapshot',
        '1.0',
        wrongHash,
      ),
      '/contextSnapshotRef/contentHash/digest',
      'pattern',
    );

    const wrongScope = resultData();
    snapshotRef(wrongScope).scope = { projectId };
    expectSchemaError(
      registry.validateOperationResult(
        'execution.build_initial_context_snapshot',
        '1.0',
        wrongScope,
      ),
      '/contextSnapshotRef/scope',
      'dependentRequired',
    );

    // A WI-02 Initial Context Snapshot is Project scoped: the enterprise-only
    // and empty scopes that the shared `scopeRef` accepts must be rejected by
    // both entry versions.
    for (const version of ['1.0', '1.1'] as const) {
      for (const testCase of [
        { scope: {}, missingProperty: 'enterpriseId' },
        { scope: { enterpriseId }, missingProperty: 'projectId' },
      ]) {
        const incompleteScope = resultData();
        snapshotRef(incompleteScope).scope = testCase.scope;
        expectSchemaError(
          registry.validateOperationResult(
            'execution.build_initial_context_snapshot',
            version,
            incompleteScope,
          ),
          '/contextSnapshotRef/scope',
          'required',
          { missingProperty: testCase.missingProperty },
        );
      }
    }

    const missingSnapshotId = resultData();
    delete snapshotRef(missingSnapshotId).snapshotId;
    expectSchemaError(
      registry.validateOperationResult(
        'execution.build_initial_context_snapshot',
        '1.0',
        missingSnapshotId,
      ),
      '/contextSnapshotRef',
      'required',
      { missingProperty: 'snapshotId' },
    );

    const extraField = resultData();
    extraField.committed = true;
    expectSchemaError(
      registry.validateOperationResult(
        'execution.build_initial_context_snapshot',
        '1.0',
        extraField,
      ),
      '',
      'additionalProperties',
      { additionalProperty: 'committed' },
    );
  });
});
describe('Task v2 creation contract', () => {
  function taskV2(): {
    readonly command: JsonObject;
    readonly definition: JsonObject;
    readonly criteria: JsonObject[];
  } {
    // Parsed once per call: every caller must mutate the object it reads, so a
    // test cannot accidentally edit a throwaway copy.
    const command = fixture('task-v2/create-task-v2-command-valid.json');
    const definition = (command.payload as JsonObject).definition as JsonObject;
    const criteria = ((definition.completionCriteria as JsonObject).criteria ?? []) as JsonObject[];
    return { command, definition, criteria };
  }

  function firstCriterion(criteria: readonly JsonObject[]): JsonObject {
    const criterion = criteria[0];
    if (criterion === undefined) throw new Error('missing Task v2 criterion fixture');
    return criterion;
  }

  function outputs(definition: JsonObject): JsonObject[] {
    return (definition.expectedOutputSpec as JsonObject).outputs as JsonObject[];
  }

  /** The closed `bindings` branch shape is rejected wherever it is applied. */
  function expectRejectedAt(result: ContractValidationResult, instancePath: string): void {
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ instancePath })]),
    );
  }

  it('registers create_task@2.0 as an exact Task CREATE command beside the v1 operation', () => {
    expect(registry.getOperation('execution.create_task', '2.0')).toMatchObject({
      owner: 'task-execution',
      kind: 'COMMAND',
      targetObjectType: 'zhiju.execution.task',
      concurrencyMode: 'CREATE',
      authorizationPurpose: 'execution.task.create',
      dataClassification: 'INTERNAL',
      references: [
        { path: '/targetRef', kind: 'OBJECT', objectType: 'zhiju.execution.task' },
        { path: '/payload/projectRef', kind: 'OBJECT', objectType: 'zhiju.project.project' },
      ],
    });
    expect(
      registry.getOperation('execution.create_task', '2.0')?.allowedConsistency,
    ).toBeUndefined();
    expect(registry.getOperation('execution.create_task', '2.0')?.resultSchemaRef).toBeUndefined();
    expect(taskExecutionOperationContracts['execution.create_task@2.0']).toEqual({
      payloadSchemaRef: `https://schemas.zhiju.local/modules/task-execution/1.0#/$defs/${operationSchemaDefinitionName(
        'execution.create_task',
        '2.0',
        'payload',
      )}`,
    });
  });

  it('accepts the approved Task v2 definition through both the envelope and the binding check', () => {
    const { command, definition, criteria } = taskV2();

    expect(registry.validateOperation('execution.create_task', '2.0', command)).toEqual({
      valid: true,
      errors: [],
    });
    expect(registry.validateTaskDefinitionBinding(definition)).toEqual({
      valid: true,
      errors: [],
    });

    // The control fixture exercises every approved criterion type, so a branch
    // guard cannot pass merely by never being reachable.
    expect(criteria.map((criterion) => criterion.criterionType)).toEqual([
      'EXPECTED_OUTPUTS_SATISFIED',
      'NO_BLOCKING_INFORMATION_REQUEST',
      'REQUIRED_WORK_ORDERS_COMPLETED',
      'REVISION_ACCEPTANCE_READY',
      'REVISION_FULLY_APPROVED',
    ]);
  });

  it('keeps the v2 definition closed and rejects non-Task targets or legacy namespaces', () => {
    const wrongTarget = taskV2();
    wrongTarget.command.targetRef = objectRef('zhiju.artifact.artifact');
    expectSchemaError(
      registry.validateOperation('execution.create_task', '2.0', wrongTarget.command),
      '/targetRef/objectType',
      'const',
      { allowedValue: 'zhiju.execution.task' },
    );

    // The historical `execution.task` / `project.project` names stay readable
    // through the frozen v1.0 fixtures only; the new entry cannot produce them.
    const legacyNamespace = taskV2();
    ((legacyNamespace.command.payload as JsonObject).projectRef as JsonObject).objectType =
      'project.project';
    expectSchemaError(
      registry.validateOperation('execution.create_task', '2.0', legacyNamespace.command),
      '/payload/projectRef/objectType',
      'const',
      { allowedValue: 'zhiju.project.project' },
    );

    const unknownField = taskV2();
    unknownField.definition.skipPolicyCheck = true;
    expectSchemaError(
      registry.validateOperation('execution.create_task', '2.0', unknownField.command),
      '/payload/definition',
      'additionalProperties',
      { additionalProperty: 'skipPolicyCheck' },
    );

    // A @1.0-style open definition is not an acceptable @2.0 definition.
    const legacyOpenDefinition = taskV2();
    legacyOpenDefinition.definition.expectedOutputSpec = { kind: 'document' };
    expectSchemaError(
      registry.validateOperation('execution.create_task', '2.0', legacyOpenDefinition.command),
      '/payload/definition/expectedOutputSpec',
      'required',
      { missingProperty: 'schemaVersion' },
    );

    const casOnCreate = taskV2();
    casOnCreate.command.expectedAggregateVersion = 0;
    expectSchemaError(
      registry.validateOperation('execution.create_task', '2.0', casOnCreate.command),
      '/expectedAggregateVersion',
      'false schema',
    );

    expect(registry.validateOperation('execution.create_task', '3.0', taskV2().command).valid).toBe(
      false,
    );
  });

  it('rejects a criterion whose bindings branch does not belong to its type', () => {
    const wrongBranch = taskV2();
    // `REQUIRED_WORK_ORDERS_COMPLETED` owns the ALL_CHILD_WORK_ORDERS branch only.
    firstCriterion(wrongBranch.criteria).criterionType = 'REQUIRED_WORK_ORDERS_COMPLETED';
    expectRejectedAt(
      registry.validateOperation('execution.create_task', '2.0', wrongBranch.command),
      '/payload/definition/completionCriteria/criteria/0/bindings',
    );
    expect(registry.validateTaskDefinitionBinding(wrongBranch.definition).valid).toBe(false);

    const scopeInOutputBranch = taskV2();
    firstCriterion(scopeInOutputBranch.criteria).bindings = { scope: 'ALL_CHILD_WORK_ORDERS' };
    expectRejectedAt(
      registry.validateOperation('execution.create_task', '2.0', scopeInOutputBranch.command),
      '/payload/definition/completionCriteria/criteria/0/bindings',
    );

    const unknownBindingField = taskV2();
    firstCriterion(unknownBindingField.criteria).bindings = {
      outputSlots: ['procedure.draft'],
      ok: true,
    };
    expectRejectedAt(
      registry.validateOperation('execution.create_task', '2.0', unknownBindingField.command),
      '/payload/definition/completionCriteria/criteria/0/bindings',
    );

    // A WorkOrder criterion type is not a Task criterion type.
    const unknownCriterionType = taskV2();
    firstCriterion(unknownCriterionType.criteria).criterionType = 'OUTPUT_REF_VALID';
    expectSchemaError(
      registry.validateOperation('execution.create_task', '2.0', unknownCriterionType.command),
      '/payload/definition/completionCriteria/criteria/0/criterionType',
      'enum',
    );

    // §11.6 fixes the first-version condition at `satisfied`; an arbitrary
    // expression is not an accepted criterion.
    const arbitraryExpression = taskV2();
    firstCriterion(arbitraryExpression.criteria).expectedCondition = {
      expression: 'outputs.length > 0',
    };
    expectSchemaError(
      registry.validateOperation('execution.create_task', '2.0', arbitraryExpression.command),
      '/payload/definition/completionCriteria/criteria/0/expectedCondition',
      'required',
      { missingProperty: 'satisfied' },
    );

    const emptyCriteria = taskV2();
    (emptyCriteria.definition.completionCriteria as JsonObject).criteria = [];
    expectSchemaError(
      registry.validateOperation('execution.create_task', '2.0', emptyCriteria.command),
      '/payload/definition/completionCriteria/criteria',
      'minItems',
    );
  });

  it('rejects duplicated criterion ids, duplicated output slots and unresolved slot bindings', () => {
    const duplicateCriterionId = taskV2();
    const secondCriterion = duplicateCriterionId.criteria[1];
    if (secondCriterion === undefined) throw new Error('missing Task v2 criterion fixture');
    secondCriterion.criterionId = firstCriterion(duplicateCriterionId.criteria).criterionId;
    // The two criteria differ structurally, so only the pure binding check can
    // see that one semantic identity was declared twice.
    expect(
      registry.validateOperation('execution.create_task', '2.0', duplicateCriterionId.command),
    ).toEqual({ valid: true, errors: [] });
    expect(registry.validateTaskDefinitionBinding(duplicateCriterionId.definition).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/completionCriteria/criteria/1/criterionId',
          code: 'DUPLICATE_CRITERION_ID',
        }),
      ]),
    );

    const duplicateSlot = taskV2();
    const firstOutput = outputs(duplicateSlot.definition)[0];
    if (firstOutput === undefined) throw new Error('missing Task v2 output fixture');
    outputs(duplicateSlot.definition).push(structuredClone(firstOutput));
    expect(
      registry.validateOperation('execution.create_task', '2.0', duplicateSlot.command).valid,
    ).toBe(true);
    expect(registry.validateTaskDefinitionBinding(duplicateSlot.definition).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/expectedOutputSpec/outputs/2/outputSlot',
          code: 'DUPLICATE_OUTPUT_SLOT',
        }),
      ]),
    );

    const unknownSlot = taskV2();
    firstCriterion(unknownSlot.criteria).bindings = {
      outputSlots: ['procedure.draft', 'procedure.missing'],
    };
    expect(registry.validateOperation('execution.create_task', '2.0', unknownSlot.command)).toEqual(
      { valid: true, errors: [] },
    );
    expect(registry.validateTaskDefinitionBinding(unknownSlot.definition).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/completionCriteria/criteria/0/bindings/outputSlots/1',
          code: 'UNKNOWN_OUTPUT_SLOT',
        }),
      ]),
    );
  });

  it('leaves every v1 create_task acceptance unchanged', () => {
    const v1 = fixture('execution-create-task-command-valid.json');
    expect(registry.validateOperation('execution.create_task', '1.0', v1)).toEqual({
      valid: true,
      errors: [],
    });

    // The historical open definition stays a v1 payload; it is not an
    // acceptable @2.0 definition even though the command name is shared.
    expect(registry.validateOperation('execution.create_task', '2.0', v1).valid).toBe(false);
    expect(registry.validateTaskDefinitionBinding(v1.payload).errors.length).toBeGreaterThan(0);
  });

  it('accepts repeated TypedReference inputRefs in v2 without rewriting the request', () => {
    // §2 declares `inputRefs: TypedReference[]`; only `dependencyTaskRefs` is a
    // Set. A repeated reference is therefore an accepted v2 request, and the
    // v1 implementation's `uniqueItems` must not be carried into the new Major.
    const inputRef = (taskV2().command.payload as JsonObject).projectRef as JsonObject;
    const cases: readonly (readonly unknown[])[] = [
      [],
      [structuredClone(inputRef)],
      [structuredClone(inputRef), structuredClone(inputRef)],
    ];

    for (const inputRefs of cases) {
      const accepted = taskV2();
      accepted.definition.inputRefs = structuredClone(inputRefs);
      const before = structuredClone(accepted.definition.inputRefs);

      expect(registry.validateOperation('execution.create_task', '2.0', accepted.command)).toEqual({
        valid: true,
        errors: [],
      });
      expect(registry.validateTaskDefinitionBinding(accepted.definition)).toEqual({
        valid: true,
        errors: [],
      });
      // The accepted request is not silently de-duplicated or reordered.
      expect(accepted.definition.inputRefs).toEqual(before);
    }

    // `dependencyTaskRefs` stays a Set: the same field-level control still
    // rejects a repeated Task reference in v2.
    const duplicateDependencies = taskV2();
    const taskRef = objectRef('zhiju.execution.task');
    duplicateDependencies.definition.dependencyTaskRefs = [
      structuredClone(taskRef),
      structuredClone(taskRef),
    ];
    expectSchemaError(
      registry.validateOperation('execution.create_task', '2.0', duplicateDependencies.command),
      '/payload/definition/dependencyTaskRefs',
      'uniqueItems',
    );
  });

  it('still rejects non-array and malformed v2 inputRefs at their public path', () => {
    const nonArray = taskV2();
    nonArray.definition.inputRefs = {};
    expectSchemaError(
      registry.validateOperation('execution.create_task', '2.0', nonArray.command),
      '/payload/definition/inputRefs',
      'type',
    );

    const malformedRef = taskV2();
    malformedRef.definition.inputRefs = [{}];
    expectSchemaError(
      registry.validateOperation('execution.create_task', '2.0', malformedRef.command),
      '/payload/definition/inputRefs/0',
      'oneOf',
    );

    // The frozen v1 payload keeps its historical Set behaviour, so the v2
    // correction is not a v1 contract change.
    const v1 = fixture('execution-create-task-command-valid.json');
    ((v1.payload as JsonObject).definition as JsonObject).inputRefs = [
      (v1.payload as JsonObject).projectRef,
    ];
    expect(registry.validateOperation('execution.create_task', '1.0', v1)).toEqual({
      valid: true,
      errors: [],
    });

    const v1Duplicate = fixture('execution-create-task-command-valid.json');
    const v1InputRef = (v1Duplicate.payload as JsonObject).projectRef as JsonObject;
    ((v1Duplicate.payload as JsonObject).definition as JsonObject).inputRefs = [
      v1InputRef,
      structuredClone(v1InputRef),
    ];
    expectSchemaError(
      registry.validateOperation('execution.create_task', '1.0', v1Duplicate),
      '/payload/definition/inputRefs',
      'uniqueItems',
    );
  });
});

describe('Task Readiness producer contract', () => {
  const buildTaskReadiness = 'execution.build_task_readiness';
  const resultSchemaRef = `https://schemas.zhiju.local/modules/task-execution/1.0#/$defs/${operationSchemaDefinitionName(
    buildTaskReadiness,
    '1.0',
    'result',
  )}`;

  // Parsed per call: every case mutates the object it reads, so a test cannot
  // accidentally edit a throwaway copy and silently pass.
  function readinessCommand(): JsonObject {
    return fixture('task-readiness/build-task-readiness-command-valid.json');
  }

  function readinessPayload(): JsonObject {
    return readinessCommand().payload as JsonObject;
  }

  function commandWithPayload(payload: JsonObject): JsonObject {
    const command = readinessCommand();
    command.payload = payload;
    return command;
  }

  function readinessResult(): JsonObject {
    return fixture('task-readiness/build-task-readiness-result-valid.json');
  }

  function readinessData(): JsonObject {
    return readinessResult().data as JsonObject;
  }

  /** The Result Ref of one already-parsed `data` object, never a fresh fixture. */
  function snapshotRefOf(data: JsonObject): JsonObject {
    return data.readinessSnapshotRef as JsonObject;
  }

  function expectBindingError(
    result: {
      readonly valid: boolean;
      readonly errors: readonly { readonly path: string; readonly code: string }[];
    },
    path: string,
    code: string,
  ): void {
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ path, code }));
  }

  it('registers the CREATE command, its exact references and its result schema', () => {
    assertTaskReadinessOperationRegistrations(publicApiOperations);
    expect(registry.getOperation(buildTaskReadiness, '1.0')).toMatchObject({
      owner: 'task-execution',
      kind: 'COMMAND',
      schemaStatus: 'FULL',
      targetObjectType: 'zhiju.execution.task_readiness',
      concurrencyMode: 'CREATE',
      authorizationPurpose: 'execution.task.readiness.build',
      dataClassification: 'INTERNAL',
      resultSchemaRef,
      references: [
        { path: '/targetRef', kind: 'OBJECT', objectType: 'zhiju.execution.task_readiness' },
        {
          path: '/payload/taskDefinitionRef',
          kind: 'CONTENT_ADDRESSED',
          objectType: 'zhiju.execution.task_definition_snapshot',
        },
        { path: '/payload/policyRef', kind: 'VERSIONED', objectType: 'zhiju.identity.policy' },
        {
          path: '/payload/evaluatorRef',
          kind: 'VERSIONED',
          objectType: 'zhiju.execution.evaluator_profile',
        },
      ],
      resultReferences: [
        {
          path: '/data/readinessSnapshotRef',
          kind: 'SNAPSHOT',
          objectType: 'zhiju.execution.task_readiness',
        },
      ],
    });
    // No dedicated build-time PayloadGuard technical Policy is approved here.
    expect(registry.getOperation(buildTaskReadiness, '1.0')?.payloadGuardPolicyRef).toBeUndefined();
    // `/payload/taskRef` stays undeclared: R-206-1 closes its spelling in the
    // owning Handler, and a declared reference would make one of the two
    // published Task spellings look like an alias of the other.
    expect(
      registry
        .getOperation(buildTaskReadiness, '1.0')
        ?.references?.some((ref) => ref.path === '/payload/taskRef'),
    ).toBe(false);
  });

  it('accepts the registered Command fixture and the bound result fixture', () => {
    expect(registry.validateOperation(buildTaskReadiness, '1.0', readinessCommand())).toEqual({
      valid: true,
      errors: [],
    });
    expect(registry.validateOperationResult(buildTaskReadiness, '1.0', readinessData())).toEqual({
      valid: true,
      errors: [],
    });
    expect(registry.validateBuildTaskReadinessCommandResult(readinessResult())).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('closes the payload to the four declared refs and leaves the Task spelling to R-206-1', () => {
    // R-206-1 accepts exactly one of two spellings, chosen by the Task's
    // creation major. Both pass these Schema, and so does a spelling no major
    // publishes: the closure is the owning Handler's, not the Schema's.
    for (const taskObjectType of ['execution.task', 'zhiju.execution.task', 'task']) {
      const payload = readinessPayload();
      (payload.taskRef as JsonObject).objectType = taskObjectType;
      expect(
        registry.validateOperation(buildTaskReadiness, '1.0', commandWithPayload(payload)),
      ).toEqual({ valid: true, errors: [] });
    }

    const extraTaskField = readinessPayload();
    (extraTaskField.taskRef as JsonObject).creationMajor = '1.0';
    expectSchemaError(
      registry.validateOperation(buildTaskReadiness, '1.0', commandWithPayload(extraTaskField)),
      '/payload/taskRef',
      'additionalProperties',
      { additionalProperty: 'creationMajor' },
    );

    const missingDefinitionRef = readinessPayload();
    delete missingDefinitionRef.taskDefinitionRef;
    expectSchemaError(
      registry.validateOperation(
        buildTaskReadiness,
        '1.0',
        commandWithPayload(missingDefinitionRef),
      ),
      '/payload',
      'required',
      { missingProperty: 'taskDefinitionRef' },
    );

    const foreignDefinitionType = readinessPayload();
    (foreignDefinitionType.taskDefinitionRef as JsonObject).objectType =
      'zhiju.execution.work_order_draft_snapshot';
    expectSchemaError(
      registry.validateOperation(
        buildTaskReadiness,
        '1.0',
        commandWithPayload(foreignDefinitionType),
      ),
      '/payload/taskDefinitionRef/objectType',
      'const',
      { allowedValue: 'zhiju.execution.task_definition_snapshot' },
    );

    const weakDefinitionRef = readinessPayload();
    (weakDefinitionRef.taskDefinitionRef as JsonObject).kind = 'OBJECT';
    expectSchemaError(
      registry.validateOperation(buildTaskReadiness, '1.0', commandWithPayload(weakDefinitionRef)),
      '/payload/taskDefinitionRef/kind',
      'const',
      { allowedValue: 'CONTENT_ADDRESSED' },
    );

    const hashedlessDefinitionRef = readinessPayload();
    delete (hashedlessDefinitionRef.taskDefinitionRef as JsonObject).contentHash;
    expectSchemaError(
      registry.validateOperation(
        buildTaskReadiness,
        '1.0',
        commandWithPayload(hashedlessDefinitionRef),
      ),
      '/payload/taskDefinitionRef',
      'required',
      { missingProperty: 'contentHash' },
    );

    // The definition snapshot and the readiness judgment are Project scoped;
    // the Policy and Evaluator refs keep the shared generic scope form.
    const incompleteDefinitionScope = readinessPayload();
    (incompleteDefinitionScope.taskDefinitionRef as JsonObject).scope = { enterpriseId };
    expectSchemaError(
      registry.validateOperation(
        buildTaskReadiness,
        '1.0',
        commandWithPayload(incompleteDefinitionScope),
      ),
      '/payload/taskDefinitionRef/scope',
      'required',
      { missingProperty: 'projectId' },
    );

    for (const [key, objectType, allowedValue] of [
      ['policyRef', 'zhiju.identity.policy_version', 'zhiju.identity.policy'],
      ['evaluatorRef', 'zhiju.execution.task_readiness', 'zhiju.execution.evaluator_profile'],
    ] as const) {
      const foreignVersionedRef = readinessPayload();
      (foreignVersionedRef[key] as JsonObject).objectType = objectType;
      expectSchemaError(
        registry.validateOperation(
          buildTaskReadiness,
          '1.0',
          commandWithPayload(foreignVersionedRef),
        ),
        `/payload/${key}/objectType`,
        'const',
        { allowedValue },
      );
    }

    const extraPayloadField = readinessPayload();
    extraPayloadField.requestedAt = '2026-09-16T00:00:00Z';
    expectSchemaError(
      registry.validateOperation(buildTaskReadiness, '1.0', commandWithPayload(extraPayloadField)),
      '/payload',
      'additionalProperties',
      { additionalProperty: 'requestedAt' },
    );

    // This entry is a CREATE: the judged Task's version is read inside the
    // transaction, so a caller-supplied CAS expectation is never accepted.
    const commandWithCas = readinessCommand();
    commandWithCas.expectedAggregateVersion = 0;
    expectSchemaError(
      registry.validateOperation(buildTaskReadiness, '1.0', commandWithCas),
      '/expectedAggregateVersion',
      'false schema',
    );
  });

  it('rejects a readiness Result Ref that is not the Project-scoped judgment', () => {
    const missingRef = readinessData();
    delete missingRef.readinessSnapshotRef;
    expectSchemaError(
      registry.validateOperationResult(buildTaskReadiness, '1.0', missingRef),
      '',
      'required',
      { missingProperty: 'readinessSnapshotRef' },
    );

    const wrongKind = readinessData();
    snapshotRefOf(wrongKind).kind = 'CONTENT_ADDRESSED';
    expectSchemaError(
      registry.validateOperationResult(buildTaskReadiness, '1.0', wrongKind),
      '/readinessSnapshotRef/kind',
      'const',
      { allowedValue: 'SNAPSHOT' },
    );

    const foreignType = readinessData();
    snapshotRefOf(foreignType).objectType = 'zhiju.execution.context_snapshot';
    expectSchemaError(
      registry.validateOperationResult(buildTaskReadiness, '1.0', foreignType),
      '/readinessSnapshotRef/objectType',
      'const',
      { allowedValue: 'zhiju.execution.task_readiness' },
    );

    for (const testCase of [
      { scope: {}, missingProperty: 'enterpriseId' },
      { scope: { enterpriseId }, missingProperty: 'projectId' },
    ]) {
      const incompleteScope = readinessData();
      snapshotRefOf(incompleteScope).scope = testCase.scope;
      expectSchemaError(
        registry.validateOperationResult(buildTaskReadiness, '1.0', incompleteScope),
        '/readinessSnapshotRef/scope',
        'required',
        { missingProperty: testCase.missingProperty },
      );
    }

    const extraField = readinessData();
    extraField.ready = true;
    expectSchemaError(
      registry.validateOperationResult(buildTaskReadiness, '1.0', extraField),
      '',
      'additionalProperties',
      { additionalProperty: 'ready' },
    );
  });

  it('binds the Result Ref to the envelope targetRef in the pure helper', () => {
    const missingRef = readinessResult();
    delete (missingRef.data as JsonObject).readinessSnapshotRef;
    expectBindingError(
      registry.validateBuildTaskReadinessCommandResult(missingRef),
      '/data/readinessSnapshotRef',
      'MISSING_CONTEXT_SNAPSHOT_REF',
    );

    const malformedRef = readinessResult();
    snapshotRefOf(malformedRef.data as JsonObject).kind = 'OBJECT';
    expectBindingError(
      registry.validateBuildTaskReadinessCommandResult(malformedRef),
      '/data/readinessSnapshotRef/kind',
      'INVALID_CONTEXT_SNAPSHOT_REF',
    );

    const foreignType = readinessResult();
    snapshotRefOf(foreignType.data as JsonObject).objectType = 'zhiju.execution.task';
    expectBindingError(
      registry.validateBuildTaskReadinessCommandResult(foreignType),
      '/data/readinessSnapshotRef/objectType',
      'FOREIGN_TASK_READINESS_OBJECT_TYPE',
    );

    const incompleteScope = readinessResult();
    snapshotRefOf(incompleteScope.data as JsonObject).scope = { enterpriseId };
    expectBindingError(
      registry.validateBuildTaskReadinessCommandResult(incompleteScope),
      '/data/readinessSnapshotRef/scope',
      'MISSING_TASK_READINESS_PROJECT_SCOPE',
    );

    // A judgment has no separate root: an id pair that disagrees with itself
    // would address a snapshot the producer never created.
    const splitIdentity = readinessResult();
    snapshotRefOf(splitIdentity.data as JsonObject).snapshotId =
      '018f22e2-7c15-7b2e-8d86-2de956a9d511';
    expectBindingError(
      registry.validateBuildTaskReadinessCommandResult(splitIdentity),
      '/data/readinessSnapshotRef/snapshotId',
      'TASK_READINESS_SNAPSHOT_IDENTITY_MISMATCH',
    );

    const nonObjectTarget = readinessResult();
    (nonObjectTarget.targetRef as JsonObject).kind = 'SNAPSHOT';
    expectBindingError(
      registry.validateBuildTaskReadinessCommandResult(nonObjectTarget),
      '/targetRef',
      'TASK_READINESS_TARGET_MISMATCH',
    );

    const foreignTarget = readinessResult();
    (foreignTarget.targetRef as JsonObject).objectType = 'execution.task';
    expectBindingError(
      registry.validateBuildTaskReadinessCommandResult(foreignTarget),
      '/targetRef',
      'TASK_READINESS_TARGET_MISMATCH',
    );

    const otherObject = readinessResult();
    (otherObject.targetRef as JsonObject).objectId = '018f22e2-7c15-7b2e-8d86-2de956a9d512';
    expectBindingError(
      registry.validateBuildTaskReadinessCommandResult(otherObject),
      '/data/readinessSnapshotRef',
      'TASK_READINESS_TARGET_MISMATCH',
    );

    const otherScope = readinessResult();
    (otherScope.targetRef as JsonObject).scope = {
      enterpriseId,
      projectId: '018f22e2-7c15-7b2e-8d86-2de956a9d299',
    };
    expectBindingError(
      registry.validateBuildTaskReadinessCommandResult(otherScope),
      '/data/readinessSnapshotRef',
      'TASK_READINESS_TARGET_MISMATCH',
    );

    const enterpriseOnlyTarget = readinessResult();
    (enterpriseOnlyTarget.targetRef as JsonObject).scope = { enterpriseId };
    expectBindingError(
      registry.validateBuildTaskReadinessCommandResult(enterpriseOnlyTarget),
      '/data/readinessSnapshotRef',
      'TASK_READINESS_TARGET_MISMATCH',
    );
  });
});

describe('WorkOrder DRAFT exact read contract', () => {
  const draftRead = 'execution.get_work_order_draft';
  const draftReadVersion = '2.0';
  const legacyQueryFixture = 'work-order-draft/get-work-order-draft-v2-query-valid.json';
  const legacyResultFixture = 'work-order-draft/get-work-order-draft-v2-result-valid.json';

  // Parsed per call: every case mutates the object it reads.
  function draftReadFixture(base: string): JsonObject {
    return fixture(base === 'result' ? legacyResultFixture : legacyQueryFixture);
  }

  function validate(base: string, input: unknown) {
    return base === 'result'
      ? registry.validateOperationResult(draftRead, draftReadVersion, input)
      : registry.validateOperation(draftRead, draftReadVersion, input);
  }

  interface NegativeCase {
    base: string;
    path: string;
    keyword: string;
    expectedPath: string;
    remove?: boolean;
    value?: unknown;
  }
  const negativeCases = JSON.parse(
    readFileSync(
      new URL(
        '../../../tests/fixtures/contracts/work-order-draft/negative-cases.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as NegativeCase[];

  function setPath(input: JsonObject, path: string, value: unknown, remove = false) {
    const keys = path.split('/').slice(1);
    const key = keys.pop();
    if (key === undefined) throw new Error('missing fixture path');
    let parent: JsonObject = input;
    for (const name of keys) parent = parent[name] as JsonObject;
    if (remove) Reflect.deleteProperty(parent, key);
    else parent[key] = value;
  }

  it('registers the additive legacy-spelling read version', () => {
    assertTaskExecutionOperationRegistrations(publicApiOperations);
    expect(registry.getOperation(draftRead, draftReadVersion)).toMatchObject({
      owner: 'task-execution',
      kind: 'QUERY',
      schemaStatus: 'FULL',
      allowedConsistency: ['AUTHORITATIVE'],
      authorizationPurpose: 'execution.work_order.draft.read',
      dataClassification: 'INTERNAL',
      resultReferences: [
        {
          path: '/draftSnapshotRef',
          kind: 'CONTENT_ADDRESSED',
          objectType: 'zhiju.execution.work_order_draft_snapshot',
        },
      ],
    });
    // §18.8: `/payload/workOrderRef` is deliberately undeclared, so no
    // reference registers one of the two published WorkOrder spellings as a
    // Catalog object type; the owning Handler closes the accept set.
    expect(registry.getOperation(draftRead, draftReadVersion)?.references).toBeUndefined();
    expect(
      registry.getOperation(draftRead, draftReadVersion)?.payloadGuardPolicyRef,
    ).toBeUndefined();
  });

  it('accepts the registered legacy query and its exact result fixture', () => {
    expect(validate('query', draftReadFixture('query'))).toEqual({ valid: true, errors: [] });
    expect(validate('result', draftReadFixture('result'))).toEqual({ valid: true, errors: [] });
  });

  it('leaves the legacy WorkOrder spelling to the owning Handler', () => {
    // R-210-1 accepts exactly one of the two published spellings, chosen by the
    // WorkOrder's creation major. All of them pass this Schema, and so does a
    // spelling no major publishes: the closure is the Handler's, not the
    // Schema's. A `const` here would have registered the other spelling as an
    // alias of the canonical one.
    for (const objectType of ['execution.work_order', 'zhiju.execution.work_order', 'work_order']) {
      const query = draftReadFixture('query');
      ((query.payload as JsonObject).workOrderRef as JsonObject).objectType = objectType;
      expect(validate('query', query)).toEqual({ valid: true, errors: [] });
    }
  });

  it('keeps the @2.0 draft shape distinct from the @1.1 InitialWorkOrderDraft', () => {
    // The exact read returns the `@1.0` creation major's `WorkOrderDraft`, whose
    // `versionPins` still requires `projectContextContractRef`; the `@1.1`
    // shape replaces it with `contextBuilderPolicyRef`. A read version that
    // accepted the other major's draft would be an alias path.
    const asV11 = registry.validateOperationResult(draftRead, '1.1', draftReadFixture('result'));
    expect(asV11.valid).toBe(false);
    expect(asV11.errors).toContainEqual(
      expect.objectContaining({
        instancePath: '/draft/versionPins',
        keyword: 'additionalProperties',
      }),
    );

    const asV20 = draftReadFixture('result');
    asV20.draft = initialWorkOrderDraft();
    const initialAsV20 = validate('result', asV20);
    expect(initialAsV20.valid).toBe(false);
    expect(initialAsV20.errors).toContainEqual(
      expect.objectContaining({ instancePath: '/draft/versionPins', keyword: 'required' }),
    );

    // The same InitialWorkOrderDraft is still the `@1.1` read's exact result.
    expect(registry.validateOperationResult(draftRead, '1.1', asV20)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it.each(negativeCases)('rejects $base $path ($keyword)', (test) => {
    const input = draftReadFixture(test.base);
    expect(validate(test.base, input)).toEqual({ valid: true, errors: [] });
    setPath(input, test.path, test.value, test.remove);
    const outcome = validate(test.base, input);
    expect(outcome.valid).toBe(false);
    expect(outcome.errors).toContainEqual(
      expect.objectContaining({
        keyword: test.keyword,
        instancePath: test.expectedPath,
      }),
    );
  });
});
