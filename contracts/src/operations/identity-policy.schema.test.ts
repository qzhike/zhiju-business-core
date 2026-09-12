import { readFileSync } from 'node:fs';

import Ajv2020Import from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { commonSchema } from '../common.schema.js';
import { operationEnvelopeSchema } from '../envelopes.schema.js';
import policiesData from '../generated/payload-guard-policies.json' with { type: 'json' };
import { publicApiOperations } from '../generated/public-api.js';
import {
  assertPolicyVersionOperationRegistrations,
  policyVersionObjectTypes,
} from '../operation-registration.js';
import {
  loadPayloadGuardPolicies,
  payloadGuardErrors,
  payloadGuardKeyword,
  resolvePayloadGuardPolicy,
} from '../payload-guard.js';
import { ContractRegistry, type ContractValidationResult } from '../registry.js';
import { operationSchemaDefinitionName } from '../schema-types.js';
import {
  identityPolicyOperationContracts,
  identityPolicySchema,
} from './identity-policy.schema.js';

interface AjvInstance {
  addKeyword(keyword: unknown): AjvInstance;
  addSchema(schema: unknown): AjvInstance;
  compile(schema: unknown): (input: unknown) => boolean;
  getSchema(id: string): ((input: unknown) => boolean) | undefined;
}

const Ajv2020 = Ajv2020Import as unknown as new (options?: object) => AjvInstance;
const registry = new ContractRegistry();
const recordType = 'identity.record_policy_version';
const queryType = 'identity.resolve_policy';
const guardPolicyRef = { type: 'identity.policy_version', version: '1.0' };
const policies = loadPayloadGuardPolicies(policiesData);
const policy = resolvePayloadGuardPolicy(policies, guardPolicyRef);
const identitySchemaId = 'https://schemas.zhiju.local/modules/identity-policy/1.0';
const enterpriseId = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const projectId = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const instant = '2026-09-12T00:00:00.000Z';
const laterInstant = '2026-09-12T02:00:00.000Z';

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

/** The Guard answers alone: one error carrying only the rule and its limit. */
function expectGuardError(
  result: ContractValidationResult,
  instancePath: string,
  rule: string,
  limit?: number,
): void {
  expect(result.valid).toBe(false);
  expect(result.errors).toEqual([
    expect.objectContaining({
      keyword: 'payloadGuard',
      instancePath,
      params: { rule, ...(limit === undefined ? {} : { limit }) },
    }),
  ]);
}

function fixture(name: string): JsonObject {
  return JSON.parse(
    readFileSync(
      new URL(`../../../tests/fixtures/contracts/policy-version/${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as JsonObject;
}

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function guardErrors(sample: unknown, mode: 'envelope' | 'result', limit: number) {
  return payloadGuardErrors(
    sample,
    { ...policy, [mode === 'envelope' ? 'maxEnvelopeBytes' : 'maxResultBytes']: limit },
    mode,
  );
}

/**
 * Fill `policyDocument` with plain ASCII chunks so the frame hits `target` bytes
 * exactly. Several chunks (never one over 16384 code points) keep the frame on
 * the byte budget instead of the independent single-string limit.
 */
function fillDocument(measured: JsonObject, holder: JsonObject, target: number): JsonObject {
  const chunks: string[] = [];
  holder.policyDocument = { chunks };
  let remaining = target - bytes(measured);
  while (remaining > 0) {
    chunks.push('a'.repeat(Math.min(remaining, 16384)));
    remaining = target - bytes(measured);
  }
  const last = chunks.at(-1);
  if (last !== undefined) chunks[chunks.length - 1] = last.slice(0, last.length + remaining);
  return measured;
}

function withDocumentSize(envelope: JsonObject, target: number): JsonObject {
  return fillDocument(envelope, envelope.payload as JsonObject, target);
}

function resolveResult(document: unknown, options: { superseded?: boolean } = {}): JsonObject {
  const result = fixture('resolve-result');
  result.policyDocument = document;
  if (options.superseded === true) {
    result.supersededAt = laterInstant;
    result.useStatus = 'NOT_YET_EFFECTIVE';
  }
  return result;
}

/** Frame without the embedded document; both samples embed the 2-byte empty document. */
function frameWithoutDocument(sample: JsonObject): number {
  return bytes(sample) - 2;
}

/** Bytes a top-level member contributes to its holder, including its separator. */
function memberBytes(holder: JsonObject, key: string): number {
  const without = structuredClone(holder);
  Reflect.deleteProperty(without, key);
  return bytes(holder) - bytes(without);
}

const policyKeyObjectId = '018f22e2-7c15-7b2e-8d86-2de956a9d440';
const policyKeyVersionId = '018f22e2-7c15-7b2e-8d86-2de956a9d441';
const policyVersionFactId = '018f22e2-7c15-7b2e-8d86-2de956a9d450';
const policyVersionHash = {
  algorithm: 'SHA-256',
  digest: 'a'.repeat(64),
  canonicalizationVersion: '1',
};

/**
 * Smallest legal `record_policy_version` envelope: empty envelope Scope, the
 * shortest typed-reference variants, a one-character idempotency key and no
 * fractional second. Only the fact Scope must carry the required `enterpriseId`.
 */
function minimalRecordCommand(scope: JsonObject, document: unknown): JsonObject {
  return {
    commandId: policyVersionFactId,
    commandType: recordType,
    commandVersion: '1.0',
    scopeRef: {},
    targetRef: {
      kind: 'OBJECT',
      objectType: 'zhiju.identity.policy_version',
      objectId: policyVersionFactId,
      scope,
    },
    actor: { kind: 'OBJECT', objectType: 'a', objectId: policyVersionFactId, scope: {} },
    authorizationDecisionRef: {
      kind: 'OBJECT',
      objectType: 'b',
      objectId: policyVersionFactId,
      scope: {},
    },
    idempotencyKey: 'x',
    correlationId: policyVersionFactId,
    requestedAt: '2026-09-12T00:00:00Z',
    payload: {
      policyRef: {
        kind: 'VERSIONED',
        objectType: 'zhiju.identity.policy',
        objectId: policyKeyObjectId,
        versionId: policyKeyVersionId,
        scope,
      },
      policySetVersion: 'v',
      policySchemaRefs: [profileReferenceByKey['ep.context_source_slice_capture.policy@1.0']],
      policyDocument: document,
      effectiveFrom: '2026-09-12T00:00:00Z',
    },
    integrity: { canonicalizationVersion: '1', payloadHash: policyVersionHash },
  };
}

/**
 * Largest legal resolve result for the same version: every result-only member at
 * its approved bound (millisecond instants, longest closed `useStatus`) while
 * `policyRef`/`policySetVersion`/`policySchemaRefs`/`effectiveFrom`/document are
 * echoed from the write payload field by field.
 */
function maximalResolveResult(payload: JsonObject, document: unknown): JsonObject {
  const key = payload.policyRef as JsonObject;
  const scope = key.scope as JsonObject;
  return {
    policyRef: key,
    policyVersionRef: {
      kind: 'SNAPSHOT',
      objectType: 'zhiju.identity.policy_version',
      objectId: policyVersionFactId,
      snapshotId: policyVersionFactId,
      scope,
      contentHash: policyVersionHash,
    },
    policySetVersion: payload.policySetVersion,
    policySchemaRefs: payload.policySchemaRefs,
    policyDocument: document,
    contentHash: policyVersionHash,
    scopeRef: scope,
    effectiveFrom: payload.effectiveFrom,
    useStatus: 'NOT_YET_EFFECTIVE',
    checkedAt: '2026-09-12T00:00:00.000Z',
    supersededAt: '2026-09-12T00:00:00.000Z',
  };
}

interface NegativeCase {
  base: 'record' | 'query' | 'result' | 'recordResult';
  path: string;
  keyword: string;
  expectedPath: string;
  remove?: boolean;
  value?: unknown;
  params?: Record<string, unknown>;
}

const negativeCases = JSON.parse(
  readFileSync(
    new URL(
      '../../../tests/fixtures/contracts/policy-version/negative-cases.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as NegativeCase[];

const fixtureByBase = {
  record: 'record-command',
  query: 'resolve-query',
  result: 'resolve-result',
  recordResult: 'record-result',
} as const;

function validate(base: NegativeCase['base'], input: unknown): ContractValidationResult {
  switch (base) {
    case 'record':
      return registry.validateOperation(recordType, '1.0', input);
    case 'query':
      return registry.validateOperation(queryType, '1.0', input);
    case 'result':
      return registry.validateOperationResult(queryType, '1.0', input);
    case 'recordResult':
      return registry.validateOperationResult(recordType, '1.0', input);
  }
}

function setPath(input: JsonObject, path: string, value: unknown, remove = false): void {
  const keys = path.split('/').slice(1);
  const key = keys.pop();
  if (key === undefined) throw new Error('missing fixture path');
  let parent: JsonObject = input;
  for (const name of keys) parent = parent[name] as JsonObject;
  if (remove) Reflect.deleteProperty(parent, key);
  else parent[key] = value;
}

const profileRegistry = JSON.parse(
  readFileSync(
    new URL('../../../contracts/registry/policy-profiles.v1.json', import.meta.url),
    'utf8',
  ),
) as { profiles: readonly { registryKey: string; reference: JsonObject }[] };
const profileReferenceByKey = Object.fromEntries(
  profileRegistry.profiles.map((profile) => [profile.registryKey, profile.reference]),
);

/** The four closed consumer profiles, paired with the #179 document fixture each owns. */
const consumerProfiles: Readonly<Record<string, string>> = {
  'ep.context_source_slice_capture.policy@1.0':
    'ep-context-source-slice-capture-policy-document-valid.json',
  'execution.context_builder.policy@1.0': 'execution-context-builder-policy-document-valid.json',
  'execution.task_readiness.policy@1.0': 'execution-task-readiness-policy-document-valid.json',
  'execution.work_order_validation.policy@1.0':
    'execution-work-order-validation-policy-document-valid.json',
};

function profileDocument(file: string): JsonObject {
  return JSON.parse(
    readFileSync(
      new URL(`../../../tests/fixtures/contracts/policy-profiles/${file}`, import.meta.url),
      'utf8',
    ),
  ) as JsonObject;
}

describe('PolicyVersion public contracts', () => {
  it('accepts the complete record, resolve and result fixtures', () => {
    const command = fixture('record-command');
    const query = fixture('resolve-query');
    const result = fixture('resolve-result');
    expect(validate('record', command)).toEqual({ valid: true, errors: [] });
    expect(validate('query', query)).toEqual({ valid: true, errors: [] });
    expect(validate('result', result)).toEqual({ valid: true, errors: [] });
    expect(validate('recordResult', fixture('record-result'))).toEqual({ valid: true, errors: [] });

    // The read side returns the same canonical payload the write side accepted
    // for the same version key.
    expect(result.policyDocument).toEqual((command.payload as JsonObject).policyDocument);
    expect((query.payload as JsonObject).policyRef).toEqual(
      (command.payload as JsonObject).policyRef,
    );

    // `supersedesRef` is the only optional payload member.
    const withoutSupersedes = structuredClone(command);
    Reflect.deleteProperty(withoutSupersedes.payload as JsonObject, 'supersedesRef');
    expect(validate('record', withoutSupersedes)).toEqual({ valid: true, errors: [] });
  });

  it.each(negativeCases)('rejects $base $path ($keyword)', (test) => {
    const input = fixture(fixtureByBase[test.base]);
    expect(validate(test.base, input)).toEqual({ valid: true, errors: [] });
    setPath(input, test.path, test.value, test.remove);
    expectSchemaError(validate(test.base, input), test.expectedPath, test.keyword, test.params);
  });

  it('registers both operations with the approved metadata and the shared guard policy', () => {
    assertPolicyVersionOperationRegistrations(publicApiOperations);
    expect(registry.getOperation(recordType, '1.0')).toMatchObject({
      owner: 'identity-policy',
      kind: 'COMMAND',
      targetObjectType: 'zhiju.identity.policy_version',
      concurrencyMode: 'CREATE',
      authorizationPurpose: 'identity.policy.record_policy_version',
      dataClassification: 'INTERNAL',
      payloadGuardPolicyRef: guardPolicyRef,
      resultSchemaRef: `${identitySchemaId}#/$defs/${operationSchemaDefinitionName(recordType, '1.0', 'result')}`,
    });
    expect(registry.getOperation(queryType, '1.0')).toMatchObject({
      owner: 'identity-policy',
      kind: 'QUERY',
      allowedConsistency: ['AUTHORITATIVE'],
      authorizationPurpose: 'identity.policy.resolve_policy',
      dataClassification: 'INTERNAL',
      payloadGuardPolicyRef: guardPolicyRef,
    });
    expect(Object.keys(identityPolicyOperationContracts)).toEqual(
      expect.arrayContaining([recordType, queryType]),
    );
    expect(policyVersionObjectTypes['zhiju.identity.policy_version'].kinds).toEqual([
      'OBJECT',
      'SNAPSHOT',
    ]);
    // The historical entries keep their own acceptance set and guard absence.
    expect(
      registry.getOperation('identity.record_policy_snapshot', '1.0')?.payloadGuardPolicyRef,
    ).toBeUndefined();
    expect(
      registry.getOperation('identity.get_policy_snapshot', '1.0')?.payloadGuardPolicyRef,
    ).toBeUndefined();
  });

  it('enforces SD-181-1 on this boundary only and leaves the shared UtcInstant unchanged', () => {
    const shared = new Ajv2020({ strict: true });
    shared.addSchema(commonSchema);
    const validateInstant = shared.getSchema(
      'https://schemas.zhiju.local/common/1.0#/$defs/utcInstant',
    );
    if (validateInstant === undefined) throw new Error('missing shared utcInstant schema');
    expect(validateInstant('2026-09-12T00:00:00.123456789Z')).toBe(true);
    expect(validateInstant('2026-09-12T00:00:00.1234Z')).toBe(true);

    const subMillisecond = fixture('record-command');
    (subMillisecond.payload as JsonObject).effectiveFrom = '2026-09-12T00:00:00.1234Z';
    expectSchemaError(validate('record', subMillisecond), '/payload/effectiveFrom', 'maxLength', {
      limit: 24,
    });

    const millisecond = fixture('record-command');
    (millisecond.payload as JsonObject).effectiveFrom = '2026-09-12T00:00:00.123Z';
    expect(validate('record', millisecond)).toEqual({ valid: true, errors: [] });

    const withoutFraction = fixture('record-command');
    (withoutFraction.payload as JsonObject).effectiveFrom = '2026-09-12T00:00:00Z';
    expect(validate('record', withoutFraction)).toEqual({ valid: true, errors: [] });

    // Relaxing SD-181-1 would unbounded the two result-only instants: the Guard
    // still accepts such a frame, and only the field bound rejects the write.
    const relaxed = resolveResult({}, { superseded: true });
    relaxed.supersededAt = `2026-09-13T00:00:00.${'0'.repeat(16363)}Z`;
    relaxed.checkedAt = `2026-09-13T00:00:00.${'0'.repeat(16363)}Z`;
    expect((relaxed.supersededAt as string).length).toBe(16384);
    expect(guardErrors(relaxed, 'result', policy.maxResultBytes)).toEqual([]);
    expectSchemaError(validate('result', relaxed), '/supersededAt', 'maxLength', { limit: 24 });
    const relaxedIncrement = 820 + 2 * ((relaxed.supersededAt as string).length - instant.length);
    expect(relaxedIncrement).toBeGreaterThan(policy.maxResultBytes - policy.maxEnvelopeBytes);
  });

  it('enforces the approved request and result byte boundaries inclusively', () => {
    expect(policy).toMatchObject({
      maxEnvelopeBytes: 262144,
      maxResultBytes: 266240,
      maxStringCodePoints: 16384,
      maxArrayItems: 1024,
      maxObjectProperties: 256,
      maxDepth: 32,
      maxRequestedKinds: 64,
    });
    expect(policy.maxResultBytes).toBe(policy.maxEnvelopeBytes + 4096);

    const atLimit = withDocumentSize(fixture('record-command'), policy.maxEnvelopeBytes);
    expect(bytes(atLimit)).toBe(policy.maxEnvelopeBytes);
    expect(validate('record', atLimit)).toEqual({ valid: true, errors: [] });
    expectGuardError(
      validate('record', withDocumentSize(fixture('record-command'), policy.maxEnvelopeBytes + 1)),
      '',
      'maxEnvelopeBytes',
      262144,
    );

    const resultAtLimit = resolveResult({});
    fillDocument(resultAtLimit, resultAtLimit, policy.maxResultBytes);
    expect(bytes(resultAtLimit)).toBe(policy.maxResultBytes);
    expect(validate('result', resultAtLimit)).toEqual({ valid: true, errors: [] });
    const resultOverLimit = resolveResult({});
    fillDocument(resultOverLimit, resultOverLimit, policy.maxResultBytes + 1);
    expectGuardError(validate('result', resultOverLimit), '', 'maxResultBytes', 266240);
  });

  it('bounds a single string by code points independently of the byte budget', () => {
    const sample = (length: number) => ({
      payload: { policyDocument: { text: 'a'.repeat(length) } },
    });
    expect(bytes(sample(16384))).toBe(16426);
    expect(guardErrors(sample(16384), 'envelope', 16426)).toEqual([]);
    expect(guardErrors(sample(16384), 'envelope', 16425)).toEqual([
      expect.objectContaining({
        instancePath: '',
        params: { rule: 'maxEnvelopeBytes', limit: 16425 },
      }),
    ]);
    expect(bytes(sample(16385))).toBe(16427);
    expect(guardErrors(sample(16385), 'envelope', 16427)).toEqual([
      expect.objectContaining({
        instancePath: '/payload/policyDocument/text',
        params: { rule: 'maxStringCodePoints', limit: 16384 },
      }),
    ]);

    const stretched = fixture('record-command');
    (stretched.payload as JsonObject).policyDocument = { text: 'a'.repeat(16384) };
    expect(validate('record', stretched)).toEqual({ valid: true, errors: [] });
    (stretched.payload as JsonObject).policyDocument = { text: 'a'.repeat(16385) };
    expectGuardError(
      validate('record', stretched),
      '/payload/policyDocument/text',
      'maxStringCodePoints',
      16384,
    );

    // Escapes and multi-byte characters are counted as compact-JSON UTF-8 bytes,
    // not as UTF-16 length or code points.
    for (const value of ['"\\\n'.repeat(400), '한'.repeat(4096)]) {
      const escaped = { payload: { policyDocument: { text: value } } };
      const total = bytes(escaped);
      expect(guardErrors(escaped, 'envelope', total)).toEqual([]);
      expect(guardErrors(escaped, 'envelope', total - 1)).toEqual([
        expect.objectContaining({
          instancePath: '',
          params: { rule: 'maxEnvelopeBytes', limit: total - 1 },
        }),
      ]);
    }
  });

  it('bounds array, object and depth dimensions without changing Set semantics', () => {
    const nested = (depth: number) => {
      let value: unknown = 'leaf';
      for (let index = 0; index < depth; index++) value = [value];
      return value;
    };
    expect(guardErrors(nested(32), 'envelope', bytes(nested(32)))).toEqual([]);
    expect(guardErrors(nested(33), 'envelope', bytes(nested(33)))).toEqual([
      expect.objectContaining({ params: { rule: 'maxDepth', limit: 32 } }),
    ]);

    const exactObject = Object.fromEntries(
      Array.from({ length: 256 }, (_, index) => [`key${index}`, 0]),
    );
    expect(guardErrors(exactObject, 'envelope', bytes(exactObject))).toEqual([]);
    const wideObject = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [`key${index}`, 0]),
    );
    expect(guardErrors(wideObject, 'envelope', bytes(wideObject))).toEqual([
      expect.objectContaining({ params: { rule: 'maxObjectProperties', limit: 256 } }),
    ]);

    const command = fixture('record-command');
    (command.payload as JsonObject).policyDocument = {
      items: Array.from({ length: 1024 }, () => 0),
    };
    expect(validate('record', command)).toEqual({ valid: true, errors: [] });
    (command.payload as JsonObject).policyDocument = {
      items: Array.from({ length: 1025 }, () => 0),
    };
    expectGuardError(
      validate('record', command),
      '/payload/policyDocument/items',
      'maxArrayItems',
      1024,
    );

    // Result side keeps ordinary array semantics: duplicates are legal there.
    const result = fixture('resolve-result');
    const schemaRefs = result.policySchemaRefs as unknown[];
    result.policySchemaRefs = [schemaRefs[0], structuredClone(schemaRefs[0])];
    expect(validate('result', result)).toEqual({ valid: true, errors: [] });
  });

  it('rejects non-JSON values and refuses to run without the guard keyword', () => {
    const circular: JsonObject = {};
    circular.self = circular;
    const accessor: JsonObject = {};
    Object.defineProperty(accessor, 'value', { get: () => 1, enumerable: true });
    class NotJson {
      readonly value = 1;
    }
    for (const illegal of [
      circular,
      { payload: { policyDocument: { text: undefined } } },
      { payload: { policyDocument: { value: Number.POSITIVE_INFINITY } } },
      { payload: { policyDocument: { value: 1n } } },
      { payload: { policyDocument: { value: () => 1 } } },
      { payload: { policyDocument: accessor } },
      { payload: { policyDocument: new NotJson() } },
    ]) {
      expect(guardErrors(illegal, 'envelope', policy.maxEnvelopeBytes)).toEqual([
        expect.objectContaining({ params: { rule: 'jsonValue' } }),
      ]);
    }
    expect(() =>
      resolvePayloadGuardPolicy(policies, { type: 'identity.policy_version', version: '2.0' }),
    ).toThrow('unknown payload guard policy');

    const command = fixture('record-command');
    (command.payload as JsonObject).policyDocument = circular;
    expectGuardError(validate('record', command), '/payload/policyDocument/self', 'jsonValue');

    const recordOperation = registry.getOperation(recordType, '1.0');
    if (recordOperation === undefined) throw new Error('missing record operation');
    const bare = new Ajv2020({ strict: true, allErrors: true });
    expect(() => bare.compile(operationEnvelopeSchema(recordOperation))).toThrow(/payloadGuard/);
    const configured = new Ajv2020({ strict: true, allErrors: true });
    configured.addKeyword(payloadGuardKeyword(policies));
    configured.addSchema(commonSchema);
    configured.addSchema(identityPolicySchema);
    const validateEnvelope = configured.compile(operationEnvelopeSchema(recordOperation));
    expect(validateEnvelope(command)).toBe(false);
    expect(validateEnvelope(fixture('record-command'))).toBe(true);

    expect(registry.validateOperation(queryType, '2.0', {})).toMatchObject({
      valid: false,
      errors: [
        expect.objectContaining({
          keyword: 'operationRegistry',
          params: { type: queryType, version: '2.0' },
        }),
      ],
    });
  });

  it('rejects an over-limit frame before structural validation without echoing content', () => {
    const inflated = {
      ...fixture('record-command'),
      bogus: Array.from({ length: 20 }, () => 'a'.repeat(16000)),
    };
    const outcome = validate('record', inflated);
    expectGuardError(outcome, '', 'maxEnvelopeBytes', 262144);
    expect(JSON.stringify(outcome.errors)).not.toContain('bogus');

    const inflatedResult = {
      ...fixture('resolve-result'),
      bogus: Array.from({ length: 20 }, () => 'a'.repeat(16000)),
    };
    expectGuardError(validate('result', inflatedResult), '', 'maxResultBytes', 266240);
  });

  it('validates results independently of an accepted request', () => {
    const accepted = withDocumentSize(fixture('record-command'), policy.maxEnvelopeBytes);
    expect(validate('record', accepted)).toEqual({ valid: true, errors: [] });

    // A frame inside the result budget but beyond the request budget is legal as
    // a result and rejected as an envelope: the two budgets are independent.
    const result = resolveResult({});
    fillDocument(result, result, policy.maxEnvelopeBytes + 1024);
    expect(bytes(result)).toBe(policy.maxEnvelopeBytes + 1024);
    expect(validate('result', result)).toEqual({ valid: true, errors: [] });

    const asEnvelope = fixture('record-command');
    (asEnvelope.payload as JsonObject).policyDocument = result.policyDocument;
    expectGuardError(validate('record', asEnvelope), '', 'maxEnvelopeBytes', 262144);
  });

  it('pairs the smallest legal write with the largest legal result under both budgets', () => {
    const headroom = policy.maxResultBytes - policy.maxEnvelopeBytes;
    expect(headroom).toBe(4096);
    const scope = { enterpriseId, projectId };

    const request = minimalRecordCommand(scope, {});
    const result = maximalResolveResult(request.payload as JsonObject, {});
    expect(validate('record', request)).toEqual({ valid: true, errors: [] });
    expect(validate('result', result)).toEqual({ valid: true, errors: [] });
    expect(
      registry.validatePolicyVersionResolutionBinding({ payload: request.payload, data: result }),
    ).toEqual({ valid: true, errors: [] });
    expect(
      registry.validatePolicyVersionCommandResult({
        targetRef: request.targetRef,
        payload: request.payload,
        data: { policyVersionRef: result.policyVersionRef },
      }),
    ).toEqual({ valid: true, errors: [] });

    // §13.3.1 定式: C_res − C_req ≤ R_only，且余量覆盖 R_only。
    const requestFrame = frameWithoutDocument(request);
    const resultFrame = frameWithoutDocument(result);
    const requestOnly = [
      'commandId',
      'commandType',
      'commandVersion',
      'scopeRef',
      'targetRef',
      'actor',
      'authorizationDecisionRef',
      'idempotencyKey',
      'correlationId',
      'requestedAt',
      'integrity',
    ].reduce((total, key) => total + memberBytes(request, key), 0);
    const resultOnly = [
      'scopeRef',
      'policyVersionRef',
      'contentHash',
      'useStatus',
      'checkedAt',
      'supersededAt',
    ].reduce((total, key) => total + memberBytes(result, key), 0);
    expect(resultOnly).toBe(820);
    expect(resultOnly).toBeLessThanOrEqual(headroom);
    expect(resultFrame - requestFrame).toBeLessThanOrEqual(resultOnly);

    // 最弱合法配对（最小请求包装 × 最大结果包装）：请求专有最小编码 903 大于结果
    // 专有最大编码 820，结果侧增量因此为负，等值预算下“合法写入读回被拒”的已批准
    // 反例（262153）在已交付形状下不可复现。下列数字是实测回归锚点，任一 Envelope
    // 或结果形状变化都必须重新推导（§13.3.1 维护规则 2）。
    expect({ requestOnly, resultOnly }).toEqual({ requestOnly: 903, resultOnly: 820 });
    const write = minimalRecordCommand(scope, {});
    fillDocument(write, write.payload as JsonObject, policy.maxEnvelopeBytes);
    expect(bytes(write)).toBe(policy.maxEnvelopeBytes);
    expect(validate('record', write)).toEqual({ valid: true, errors: [] });
    const readBack = maximalResolveResult(
      write.payload as JsonObject,
      (write.payload as JsonObject).policyDocument,
    );
    expect(validate('result', readBack)).toEqual({ valid: true, errors: [] });
    const readFrame = bytes(readBack);
    expect({ requestFrame, resultFrame, readFrame }).toEqual({
      requestFrame: 1476,
      resultFrame: 1381,
      readFrame: 262049,
    });
    expect(guardErrors(readBack, 'result', policy.maxEnvelopeBytes)).toEqual([]);
    expect(guardErrors(readBack, 'result', policy.maxResultBytes)).toEqual([]);
    // 预算独立性对照：结果帧超过请求预算时只由 maxResultBytes 拒绝，并在 266240 下通过。
    const oversized = maximalResolveResult(
      write.payload as JsonObject,
      (write.payload as JsonObject).policyDocument,
    );
    fillDocument(oversized, oversized, policy.maxResultBytes);
    expect(bytes(oversized)).toBe(policy.maxResultBytes);
    expect(guardErrors(oversized, 'result', policy.maxEnvelopeBytes)).toEqual([
      expect.objectContaining({
        instancePath: '',
        params: { rule: 'maxResultBytes', limit: policy.maxEnvelopeBytes },
      }),
    ]);
    expect(guardErrors(oversized, 'result', policy.maxResultBytes)).toEqual([]);
  });

  it('measures the published sample frames and their inclusive boundaries', () => {
    const samples: readonly (readonly [string, unknown, number])[] = [
      ['empty object', {}, 2],
      ['a x40 document', { payload: { policyDocument: { text: 'a'.repeat(40) } } }, 82],
      [
        'single 16384 code point string',
        { payload: { policyDocument: { text: 'a'.repeat(16384) } } },
        16426,
      ],
    ];
    for (const [label, sample, expected] of samples) {
      expect({ label, bytes: bytes(sample) }).toEqual({ label, bytes: expected });
      expect(guardErrors(sample, 'envelope', expected)).toEqual([]);
      expect(guardErrors(sample, 'envelope', expected - 1)).toEqual([
        expect.objectContaining({
          instancePath: '',
          params: { rule: 'maxEnvelopeBytes', limit: expected - 1 },
        }),
      ]);
    }
    expect(bytes(fixture('record-result'))).toBe(446);
    expect(guardErrors(fixture('record-result'), 'result', 446)).toEqual([]);
    expect(guardErrors(fixture('record-result'), 'result', 445)).toEqual([
      expect.objectContaining({
        instancePath: '',
        params: { rule: 'maxResultBytes', limit: 445 },
      }),
    ]);

    // The resolve request envelope gets the same single-variable B / B−1 check.
    const resolveQuery = fixture('resolve-query');
    const queryFrame = bytes(resolveQuery);
    expect(queryFrame).toBe(1311);
    expect(validate('query', resolveQuery)).toEqual({ valid: true, errors: [] });
    expect(guardErrors(resolveQuery, 'envelope', queryFrame)).toEqual([]);
    expect(guardErrors(resolveQuery, 'envelope', queryFrame - 1)).toEqual([
      expect.objectContaining({
        instancePath: '',
        params: { rule: 'maxEnvelopeBytes', limit: queryFrame - 1 },
      }),
    ]);
  });

  it('seeds every registered consumer profile and leaves its document semantics to its owner', () => {
    for (const [registryKey, file] of Object.entries(consumerProfiles)) {
      const document = profileDocument(file);
      const reference = profileReferenceByKey[registryKey];
      expect({ registryKey, reference: reference !== undefined }).toEqual({
        registryKey,
        reference: true,
      });
      expect(registry.validatePolicyProfileDocument(registryKey, document).valid).toBe(true);

      const command = fixture('record-command');
      const payload = command.payload as JsonObject;
      payload.policySchemaRefs = [reference];
      payload.policyDocument = document;
      expect({ registryKey, ...validate('record', command) }).toEqual({
        registryKey,
        valid: true,
        errors: [],
      });

      // The operation schema does not interpret or narrow profile rule fields;
      // the owning consumer's closed document schema still rejects the addition.
      payload.policyDocument = { ...document, unexpectedProfileField: true };
      expect(validate('record', command)).toEqual({ valid: true, errors: [] });
      expect(
        registry.validatePolicyProfileDocument(registryKey, payload.policyDocument).valid,
      ).toBe(false);
    }
  });

  it('binds the write result to the CREATE target and echoes the read reference', () => {
    const command = fixture('record-command');
    const recordResult = fixture('record-result');
    expect(
      registry.validatePolicyVersionCommandResult({
        targetRef: command.targetRef,
        payload: command.payload,
        data: recordResult,
      }),
    ).toEqual({ valid: true, errors: [] });

    const mismatchedTarget = structuredClone(command);
    (mismatchedTarget.targetRef as JsonObject).objectId = '018f22e2-7c15-7b2e-8d86-2de956a9d499';
    expect(
      registry.validatePolicyVersionCommandResult({
        targetRef: mismatchedTarget.targetRef,
        payload: command.payload,
        data: recordResult,
      }),
    ).toEqual({
      valid: false,
      errors: [
        expect.objectContaining({
          path: '/data/policyVersionRef',
          code: 'POLICY_VERSION_TARGET_MISMATCH',
        }),
      ],
    });

    const brokenFact = structuredClone(recordResult);
    (brokenFact.policyVersionRef as JsonObject).snapshotId = '018f22e2-7c15-7b2e-8d86-2de956a9d499';
    expect(
      registry.validatePolicyVersionCommandResult({
        targetRef: command.targetRef,
        payload: command.payload,
        data: brokenFact,
      }),
    ).toEqual({
      valid: false,
      errors: [
        expect.objectContaining({
          path: '/data/policyVersionRef/snapshotId',
          code: 'MALFORMED_POLICY_VERSION_REF',
        }),
      ],
    });

    const query = fixture('resolve-query');
    const result = fixture('resolve-result');
    expect(
      registry.validatePolicyVersionResolutionBinding({ payload: query.payload, data: result }),
    ).toEqual({ valid: true, errors: [] });

    const echoed = structuredClone(result);
    (echoed.policyRef as JsonObject).versionId = '018f22e2-7c15-7b2e-8d86-2de956a9d499';
    expect(
      registry.validatePolicyVersionResolutionBinding({ payload: query.payload, data: echoed }),
    ).toEqual({
      valid: false,
      errors: [
        expect.objectContaining({ path: '/data/policyRef', code: 'POLICY_REF_ECHO_MISMATCH' }),
      ],
    });

    const scoped = structuredClone(result);
    (scoped.scopeRef as JsonObject).projectId = '018f22e2-7c15-7b2e-8d86-2de956a9d499';
    expect(
      registry.validatePolicyVersionResolutionBinding({ payload: query.payload, data: scoped }),
    ).toEqual({
      valid: false,
      errors: [
        expect.objectContaining({ path: '/data/scopeRef', code: 'POLICY_VERSION_SCOPE_MISMATCH' }),
      ],
    });

    const rehashed = structuredClone(result);
    (rehashed.contentHash as JsonObject).digest = 'b'.repeat(64);
    expect(
      registry.validatePolicyVersionResolutionBinding({ payload: query.payload, data: rehashed }),
    ).toEqual({
      valid: false,
      errors: [
        expect.objectContaining({ path: '/data/contentHash', code: 'POLICY_REF_ECHO_MISMATCH' }),
      ],
    });
  });
});
