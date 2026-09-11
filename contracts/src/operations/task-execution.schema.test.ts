import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { publicApiOperations } from '../generated/public-api.js';
import { assertTaskExecutionOperationRegistrations } from '../operation-registration.js';
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
    expect(registry.operationCount).toBe(208);
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
