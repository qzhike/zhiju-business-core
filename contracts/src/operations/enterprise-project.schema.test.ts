import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv2020Import from 'ajv/dist/2020.js';
import type { AnySchemaObject, KeywordDefinition, ValidateFunction } from 'ajv';
import { ContractRegistry } from '../registry.js';
import { commonSchema } from '../common.schema.js';
import { operationEnvelopeSchema } from '../envelopes.schema.js';
import { enterpriseProjectSchema } from './enterprise-project.schema.js';
import {
  loadPayloadGuardPolicies,
  payloadGuardErrors,
  payloadGuardKeyword,
  resolvePayloadGuardPolicy,
} from '../payload-guard.js';
import policiesData from '../generated/payload-guard-policies.json' with { type: 'json' };
import { publicApiOperations } from '../generated/public-api.js';
import {
  assertResolutionReceiptCompatibilityMetadata,
  assertResolutionReceiptOperationRegistrations,
  assertSliceOperationRegistrations,
  assertSliceCompatibilityMetadata,
} from '../operation-registration.js';
import type { PublicOperationDefinition } from '../schema-types.js';

const registry = new ContractRegistry();
const captureType = 'project.capture_context_source_slice';
const queryType = 'project.get_context_source_slice';
const policies = loadPayloadGuardPolicies(policiesData);
const policy = resolvePayloadGuardPolicy(policies, {
  type: 'ep.context_source_slice',
  version: '1.0',
});
interface SourceFixture extends Record<string, unknown> {
  factItems: unknown[];
  activeBaselineRefs: unknown[];
  omissions: unknown[];
  redactions: unknown[];
}
interface Fixture extends Record<string, unknown> {
  payload: Record<string, unknown> & { requestedKinds: string[] };
  slice: Record<string, unknown> & { source: SourceFixture };
  pagination: Record<string, unknown>;
  queryType: string;
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('expected fixture object');
  return value as Record<string, unknown>;
}
function operation(type: string): PublicOperationDefinition {
  const op = registry.getOperation(type, '1.0');
  if (op === undefined) throw new Error('missing fixture operation');
  return op;
}
function mutableOperation(
  operations: Record<string, unknown>[],
  type: string,
): Record<string, unknown> {
  const op = operations.find((entry) => entry.type === type);
  if (op === undefined) throw new Error('missing mutable fixture operation');
  return op;
}
function readFixture(name: string): Fixture {
  return JSON.parse(
    readFileSync(
      new URL(
        `../../../tests/fixtures/contracts/context-source-slice/${name}.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  ) as Fixture;
}
function fixture(name: string): Fixture {
  return readFixture(name);
}
function validate(base: string, input: unknown) {
  return base === 'result'
    ? registry.validateOperationResult(queryType, '1.0', input)
    : registry.validateOperation(base === 'capture' ? captureType : queryType, '1.0', input);
}
interface NegativeCase {
  base: string;
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
      '../../../tests/fixtures/contracts/context-source-slice/negative-cases.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as NegativeCase[];

function setPath(input: Fixture, path: string, value: unknown, remove = false) {
  const keys = path.split('/').slice(1);
  const key = keys.pop();
  if (key === undefined) throw new Error('missing fixture path');
  let parent: Record<string, unknown> = input;
  for (const name of keys) parent = object(parent[name]);
  if (remove) Reflect.deleteProperty(parent, key);
  else parent[key] = value;
}
function expectGuard(base: string, input: unknown, path: string, rule: string) {
  const outcome = validate(base, input);
  expect(outcome.valid).toBe(false);
  expect(outcome.errors).toEqual([
    expect.objectContaining({
      keyword: 'payloadGuard',
      instancePath: path,
      params: expect.objectContaining({ rule }),
    }),
  ]);
}

describe('persistent ContextSourceSlice public contracts', () => {
  for (const base of ['capture', 'query', 'result'])
    it(`accepts complete ${base} fixture`, () => {
      expect(validate(base, fixture(base))).toEqual({ valid: true, errors: [] });
    });
  it.each(negativeCases)('rejects $base $path ($keyword)', (test) => {
    const input = fixture(test.base);
    expect(validate(test.base, input)).toEqual({ valid: true, errors: [] });
    setPath(input, test.path, test.value, test.remove);
    const outcome = validate(test.base, input);
    expect(outcome.valid).toBe(false);
    expect(outcome.errors).toContainEqual(
      expect.objectContaining({
        keyword: test.keyword,
        instancePath: test.expectedPath,
        ...(test.params === undefined ? {} : { params: expect.objectContaining(test.params) }),
      }),
    );
  });
  it('accepts empty and maximum Sets and each use status', () => {
    for (const n of [0, 64]) {
      const input = fixture('capture');
      input.payload.requestedKinds = Array.from({ length: n }, (_, i) => `kind_${i}`);
      expect(validate('capture', input).valid).toBe(true);
    }
    for (const useStatus of ['USABLE', 'EXPIRED', 'REVOKED'])
      expect(validate('result', { ...fixture('result'), useStatus }).valid).toBe(true);
  });
  it('preserves named source identity and ordinary array duplicate semantics', () => {
    const input = fixture('result');
    for (const key of ['activeBaselineRefs', 'factItems', 'omissions', 'redactions'] as const)
      input.slice.source[key].push(input.slice.source[key][0]);
    expect(validate('result', input).valid).toBe(true);
    expect(enterpriseProjectSchema.$defs.contextSourceSlice.properties.source).toEqual({
      $ref: 'https://schemas.zhiju.local/modules/enterprise-project/1.0#/$defs/projectContextSourceSlice',
    });
  });
  it('exposes exact scoped registration metadata through the public Registry', () => {
    assertSliceOperationRegistrations(publicApiOperations);
    expect(registry.getOperation(captureType, '1.0')).toMatchObject({
      owner: 'enterprise-project',
      targetObjectType: 'zhiju.project.context_source_slice',
      concurrencyMode: 'CREATE',
      authorizationPurpose: 'project.context_source.capture',
      payloadGuardPolicyRef: { type: policy.type, version: policy.version },
    });
    expect(registry.getOperation(queryType, '1.0')).toMatchObject({
      allowedConsistency: ['AUTHORITATIVE'],
      authorizationPurpose: 'project.context_source.read',
    });
  });
});

describe('slice resource limits through the public Registry', () => {
  it.each([
    undefined,
    { pageSize: 1 },
    { pageSize: 1, cursor: 'a'.repeat(16) },
    { pageSize: 1, cursor: 'a'.repeat(512) },
  ])('accepts valid PageRequest %#', (pagination) => {
    const input = fixture('query');
    if (pagination !== undefined) input.pagination = pagination;
    expect(validate('query', input)).toEqual({ valid: true, errors: [] });
  });
  it('preserves the legacy Query pagination acceptance set', () => {
    const input = fixture('query');
    input.queryType = 'project.get_project_context_source';
    input.payload = {
      projectRef: fixture('result').slice.source.projectRef,
      purpose: 'context.snapshot.read',
      audience: input.requester,
      requestedKinds: [],
    };
    for (const pagination of [{}, { pageSize: 0 }, { padding: [] }, { pageSize: 1, cursor: '!' }]) {
      input.pagination = pagination;
      expect(registry.validateOperation(input.queryType, '1.0', input).valid).toBe(true);
    }
  });
  it('enforces the Query byte limit with otherwise-valid references and PageRequest', () => {
    const input = fixture('query');
    input.pagination = { pageSize: 1, cursor: 'a'.repeat(16) };
    // ExternalRef is an existing TypedReference variant in these Envelope fields.
    // These synthetic values test shape/size only, not reference existence or authorization.
    const references = Array.from({ length: 2 }, () => ({
      system: 'a'.repeat(10000),
      resourceType: 'b'.repeat(10000),
      externalId: 'x',
      adapterVersion: '1',
      observedAt: '2026-09-10T00:00:00Z',
    }));
    input.authenticationContextRef = references[0];
    input.authorizationDecisionRef = references[1];
    expect(validate('query', input)).toEqual({ valid: true, errors: [] });
    let last:
      { ref: (typeof references)[number]; key: 'externalId' | 'adapterVersion' } | undefined;
    for (const ref of references) {
      for (const key of ['externalId', 'adapterVersion'] as const) {
        const remaining = 262144 - Buffer.byteLength(JSON.stringify(input), 'utf8');
        const count = Math.min(15000, Math.floor(remaining / 4));
        ref[key] += '😀'.repeat(count) + 'a'.repeat(Math.min(remaining - count * 4, 3));
        last = { ref, key };
        if (Buffer.byteLength(JSON.stringify(input), 'utf8') === 262144) break;
      }
      if (Buffer.byteLength(JSON.stringify(input), 'utf8') === 262144) break;
    }
    expect(Buffer.byteLength(JSON.stringify(input), 'utf8')).toBe(262144);
    expect(validate('query', input)).toEqual({ valid: true, errors: [] });
    if (last === undefined) throw new Error('missing query boundary field');
    last.ref[last.key] += 'a';
    expect(Buffer.byteLength(JSON.stringify(input), 'utf8')).toBe(262145);
    expectGuard('query', input, '', 'maxEnvelopeBytes');
  });

  it.each(['a', '中', '😀', '\\', '"', '\n'])(
    'counts code points and UTF-8 safely (%j)',
    (character) => {
      const input = fixture('result');
      input.slice.source.factItems = [character.repeat(16384)];
      expect(validate('result', input).valid).toBe(true);
      input.slice.source.factItems[0] = String(input.slice.source.factItems[0]) + character;
      expectGuard('result', input, '/slice/source/factItems/0', 'maxStringCodePoints');
    },
  );
  it('bounds object keys and escapes JSON Pointer paths', () => {
    const input = fixture('result');
    const key = '~/' + 'a'.repeat(16382);
    input.slice.source.factItems = [{ [key]: true }];
    expect(validate('result', input).valid).toBe(true);
    input.slice.source.factItems = [{ [key + 'a']: true }];
    expectGuard(
      'result',
      input,
      '/slice/source/factItems/0/~0~1' + 'a'.repeat(16383),
      'maxStringCodePoints',
    );
  });
  it('bounds each array and object without imposing Set semantics', () => {
    const input = fixture('result');
    input.slice.source.factItems = Array.from({ length: 1024 }, () => null);
    expect(validate('result', input).valid).toBe(true);
    input.slice.source.factItems.push(null);
    expectGuard('result', input, '/slice/source/factItems', 'maxArrayItems');
    input.slice.source.factItems = [
      Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`key${i}`, true])),
    ];
    expect(validate('result', input).valid).toBe(true);
    object(input.slice.source.factItems[0]).extra = true;
    expectGuard('result', input, '/slice/source/factItems/0', 'maxObjectProperties');
  });
  it('bounds container depth before structural recursion', () => {
    const input = fixture('result');
    let nested: unknown = true;
    for (let n = 0; n < 28; n++) nested = { x: nested };
    input.slice.source.factItems = [nested];
    expect(validate('result', input).valid).toBe(true);
    input.slice.source.factItems = [{ x: nested }];
    expectGuard('result', input, '/slice/source/factItems/0' + '/x'.repeat(28), 'maxDepth');
    for (let n = 0; n < 10000; n++) nested = { x: nested };
    input.slice.source.factItems = [nested];
    expectGuard('result', input, '/slice/source/factItems/0' + '/x'.repeat(28), 'maxDepth');
  });

  function padToBytes(base: string, bytes: number, character: string): Fixture {
    const input = fixture(base);
    const padding: string[] = [];
    if (base === 'result') input.slice.source.factItems = padding;
    else if (base === 'capture') input.payload.requestedKinds = padding;
    else throw new Error('use the dedicated bounded Query fixture');
    // Independent fixture sizing uses native JSON serialization, not the guard's counter.
    let remaining = bytes - Buffer.byteLength(JSON.stringify(input), 'utf8');
    const perChar = Buffer.byteLength(JSON.stringify(character), 'utf8') - 2;
    while (remaining > 0) {
      const index = padding.length;
      const prefix = base === 'capture' ? `kind_${index}_` : '';
      remaining -= Buffer.byteLength(JSON.stringify(prefix), 'utf8') + (index === 0 ? 0 : 1);
      const count = Math.min(15000, Math.floor(remaining / perChar));
      if (count < 0) throw new Error('fixture padding overshot');
      const tail = Math.min(remaining - count * perChar, perChar - 1);
      padding.push(prefix + character.repeat(count) + 'a'.repeat(tail));
      remaining -= count * perChar + tail;
    }
    expect(Buffer.byteLength(JSON.stringify(input), 'utf8')).toBe(bytes);
    return input;
  }
  for (const base of ['capture', 'result']) {
    for (const character of base === 'capture' ? ['a'] : ['a', '中', '😀', '\\', '\n']) {
      it(`enforces exact ${base} byte boundary for ${JSON.stringify(character)}`, () => {
        const limit = base === 'result' ? 4194304 : 262144;
        const input = padToBytes(base, limit, character);
        expect(validate(base, input)).toEqual({ valid: true, errors: [] });
        const padding =
          base === 'result' ? input.slice.source.factItems : input.payload.requestedKinds;
        padding[padding.length - 1] = String(padding[padding.length - 1]) + 'a';
        expect(Buffer.byteLength(JSON.stringify(input), 'utf8')).toBe(limit + 1);
        expectGuard(base, input, '', base === 'result' ? 'maxResultBytes' : 'maxEnvelopeBytes');
      });
    }
  }
  it.each([
    undefined,
    NaN,
    Infinity,
    -Infinity,
    1n,
    () => true,
    new Date(),
    Object.assign([], { extra: true }),
    new Array(2),
  ])('rejects non-JSON input safely (case %#)', (bad) => {
    const input = fixture('result');
    input.slice.source.factItems = [bad];
    expectGuard('result', input, '/slice/source/factItems/0', 'jsonValue');
  });
  it('rejects cycles and accessors without calling them; shared JSON values remain valid', () => {
    const input = fixture('result');
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    input.slice.source.factItems = [cycle];
    expectGuard('result', input, '/slice/source/factItems/0/self', 'jsonValue');
    let called = false;
    input.slice.source.factItems = [
      Object.defineProperty({}, 'secret', {
        enumerable: true,
        get() {
          called = true;
          return 'secret';
        },
      }),
    ];
    expectGuard('result', input, '/slice/source/factItems/0/secret', 'jsonValue');
    expect(called).toBe(false);
    const shared = { value: 1 };
    input.slice.source.factItems = [shared, shared];
    expect(validate('result', input).valid).toBe(true);
  });
  it('does not narrow the legacy dynamic source query result', () => {
    const source = fixture('result').slice.source;
    source.factItems = ['a'.repeat(16385)];
    expect(
      registry.validateOperationResult('project.get_project_context_source', '1.0', source).valid,
    ).toBe(true);
    const query = fixture('query');
    query.queryType = 'project.get_project_context_source';
    query.payload = {
      projectRef: source.projectRef,
      purpose: 'context.snapshot.read',
      audience: query.requester,
      requestedKinds: [],
    };
    expect(registry.validateOperation(query.queryType, '1.0', query).valid).toBe(true);
  });
});

describe('build-time guard registration', () => {
  for (const key of [
    'maxEnvelopeBytes',
    'maxResultBytes',
    'maxStringCodePoints',
    'maxArrayItems',
    'maxObjectProperties',
    'maxDepth',
    'maxRequestedKinds',
  ]) {
    for (const invalid of [0, -1, 1.5, Infinity, undefined])
      it(`rejects ${key}=${String(invalid)}`, () => {
        expect(() =>
          loadPayloadGuardPolicies({ policies: [{ ...policy, [key]: invalid }] }),
        ).toThrow('invalid');
      });
  }
  it('rejects unknown fields, duplicate identities, invalid and unresolved references', () => {
    expect(() => loadPayloadGuardPolicies({ policies: [{ ...policy, extra: 1 }] })).toThrow(
      'invalid',
    );
    expect(() => loadPayloadGuardPolicies({ policies: [policy, policy] })).toThrow('duplicate');
    expect(() => resolvePayloadGuardPolicy(policies, { type: 'missing', version: '1.0' })).toThrow(
      'unknown',
    );
    expect(() =>
      resolvePayloadGuardPolicy(policies, { type: policy.type, version: policy.version, extra: 1 }),
    ).toThrow('invalid');
  });
  for (const field of [
    'owner',
    'kind',
    'schemaStatus',
    'authorizationPurpose',
    'dataClassification',
    'payloadGuardPolicyRef',
    'references',
    'targetObjectType',
    'concurrencyMode',
  ]) {
    it(`rejects missing capture registration ${field}`, () => {
      const operations = structuredClone(publicApiOperations) as unknown as Record<
        string,
        unknown
      >[];
      Reflect.deleteProperty(mutableOperation(operations, captureType), field);
      expect(() => {
        assertSliceOperationRegistrations(operations as unknown as PublicOperationDefinition[]);
      }).toThrow();
    });
  }
  it('rejects missing query consistency/result references, unknown Ref names, duplicate operations and wildcard Purpose', () => {
    for (const field of ['allowedConsistency', 'resultReferences']) {
      const operations = structuredClone(publicApiOperations) as unknown as Record<
        string,
        unknown
      >[];
      Reflect.deleteProperty(mutableOperation(operations, queryType), field);
      expect(() => {
        assertSliceOperationRegistrations(operations as unknown as PublicOperationDefinition[]);
      }).toThrow();
    }
    const operations = structuredClone(publicApiOperations) as unknown as Record<string, unknown>[];
    const mutated = mutableOperation(operations, captureType);
    object((mutated.references as unknown[])[0]).objectType = 'unknown.type';
    expect(() => {
      assertSliceOperationRegistrations(operations as unknown as PublicOperationDefinition[]);
    }).toThrow();
    expect(() => {
      assertSliceOperationRegistrations([...publicApiOperations, operation(captureType)]);
    }).toThrow();
    mutated.authorizationPurpose = '*';
    expect(() => {
      assertSliceOperationRegistrations(operations as unknown as PublicOperationDefinition[]);
    }).toThrow();
  });
  interface AjvRuntime {
    addKeyword(definition: KeywordDefinition): AjvRuntime;
    addSchema(schema: AnySchemaObject): AjvRuntime;
    compile(schema: AnySchemaObject): ValidateFunction;
  }
  const Ajv2020 = Ajv2020Import as unknown as new (options: object) => AjvRuntime;
  it('requires the executable keyword and rejects unknown Policy while compiling', () => {
    const schema = operationEnvelopeSchema(operation(queryType));
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    ajv.addSchema(commonSchema).addSchema(enterpriseProjectSchema);
    expect(() => ajv.compile(schema)).toThrow(/payloadGuard/);
    const configured = new Ajv2020({ strict: true, allErrors: true });
    configured
      .addKeyword(payloadGuardKeyword(policies))
      .addSchema(commonSchema)
      .addSchema(enterpriseProjectSchema);
    expect(() =>
      configured.compile({ ...schema, payloadGuard: { type: 'unknown', version: '1.0' } }),
    ).toThrow('unknown payload guard policy');
  });
  it('executes the assertion with an independent Ajv loader and the same public schemas', () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    ajv
      .addKeyword(payloadGuardKeyword(policies))
      .addSchema(commonSchema)
      .addSchema(enterpriseProjectSchema);
    const validateEnvelope = ajv.compile(operationEnvelopeSchema(operation(queryType)));
    const input = fixture('query');
    input.pagination = { pageSize: 1 };
    object(input.requester).objectType = 'a'.repeat(16385);
    expect(validateEnvelope(input)).toBe(false);
    expect(validateEnvelope.errors).toContainEqual(
      expect.objectContaining({ keyword: 'payloadGuard', instancePath: '/requester/objectType' }),
    );
    expect(payloadGuardErrors(input, policy, 'envelope')).toEqual([
      expect.objectContaining({ instancePath: '/requester/objectType' }),
    ]);
  });
});

describe('slice metadata parity', () => {
  it('rejects missing, duplicated and divergent compatibility declarations', () => {
    const metadata = JSON.parse(
      readFileSync(
        new URL('../../registry/operation-compatibility-metadata.v1.json', import.meta.url),
        'utf8',
      ),
    ) as {
      operations: {
        type: string;
        version: string;
        authorizationPurpose: string;
        dataClassification: string;
      }[];
    };
    expect(() => {
      assertSliceCompatibilityMetadata(publicApiOperations, metadata.operations);
    }).not.toThrow();
    const entry = metadata.operations.find((item) => item.type === captureType);
    if (entry === undefined) throw new Error('missing compatibility fixture');
    expect(() => {
      assertSliceCompatibilityMetadata(
        publicApiOperations,
        metadata.operations.filter((item) => item !== entry),
      );
    }).toThrow('inconsistent');
    expect(() => {
      assertSliceCompatibilityMetadata(publicApiOperations, [...metadata.operations, entry]);
    }).toThrow('inconsistent');
    for (const field of ['authorizationPurpose', 'dataClassification'] as const) {
      expect(() => {
        assertSliceCompatibilityMetadata(
          publicApiOperations,
          metadata.operations.map((item) => (item === entry ? { ...item, [field]: '*' } : item)),
        );
      }).toThrow('inconsistent');
    }
  });
});

// ===========================================================================
// IM-06 (#191): narrow resolution receipt attestation Query
// ===========================================================================

const receiptType = 'project.get_resolution_receipt';

interface ReceiptNegativeCase {
  base: string;
  path: string;
  keyword: string;
  expectedPath: string;
  remove?: boolean;
  value?: unknown;
  params?: Record<string, unknown>;
}

function readReceiptFixture(name: string): Fixture {
  return JSON.parse(
    readFileSync(
      new URL(`../../../tests/fixtures/contracts/resolution-receipt/${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as Fixture;
}

const receiptNegativeCases = JSON.parse(
  readFileSync(
    new URL(
      '../../../tests/fixtures/contracts/resolution-receipt/negative-cases.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as ReceiptNegativeCase[];

function validateReceipt(base: string, input: unknown) {
  return base === 'result'
    ? registry.validateOperationResult(receiptType, '1.0', input)
    : registry.validateOperation(receiptType, '1.0', input);
}

describe('resolution receipt attestation public contracts', () => {
  it('accepts the complete Query and attestation fixtures', () => {
    expect(validateReceipt('query', readReceiptFixture('query'))).toEqual({
      valid: true,
      errors: [],
    });
    expect(validateReceipt('result', readReceiptFixture('result'))).toEqual({
      valid: true,
      errors: [],
    });
  });

  it.each(receiptNegativeCases)('rejects $base $path ($keyword)', (test) => {
    const input = readReceiptFixture(test.base);
    expect(validateReceipt(test.base, input)).toEqual({ valid: true, errors: [] });
    setPath(input, test.path, test.value, test.remove);
    const outcome = validateReceipt(test.base, input);
    expect(outcome.valid).toBe(false);
    expect(outcome.errors).toContainEqual(
      expect.objectContaining({
        keyword: test.keyword,
        instancePath: test.expectedPath,
        ...(test.params === undefined ? {} : { params: expect.objectContaining(test.params) }),
      }),
    );
  });

  it('exposes exact scoped registration metadata through the public Registry', () => {
    assertResolutionReceiptOperationRegistrations(publicApiOperations);
    expect(registry.getOperation(receiptType, '1.0')).toMatchObject({
      owner: 'enterprise-project',
      kind: 'QUERY',
      schemaStatus: 'FULL',
      allowedConsistency: ['AUTHORITATIVE'],
      authorizationPurpose: 'project.resolution_receipt.read',
      dataClassification: 'CUSTOMER_CONFIDENTIAL',
      references: [
        {
          path: '/payload/commandReceiptRef',
          kind: 'CONTENT_ADDRESSED',
          objectType: 'zhiju.project.command_receipt',
        },
      ],
      resultReferences: [
        {
          path: '/commandReceiptRef',
          kind: 'CONTENT_ADDRESSED',
          objectType: 'zhiju.project.command_receipt',
        },
        { path: '/targetRef', kind: 'OBJECT', objectType: 'zhiju.project.customer_material' },
        {
          path: '/candidateVersionRef',
          kind: 'VERSIONED',
          objectType: 'zhiju.project.customer_material',
        },
        {
          path: '/confirmedVersionRef',
          kind: 'VERSIONED',
          objectType: 'zhiju.project.customer_material',
        },
        {
          path: '/sourceMaterialRefs',
          kind: 'CONTENT_ADDRESSED',
          objectType: 'zhiju.project.source_material',
        },
        {
          path: '/decisionRef',
          kind: 'CONTENT_ADDRESSED',
          objectType: 'zhiju.project.business_decision',
        },
        { path: '/actorRef', kind: 'PRINCIPAL', objectType: 'zhiju.identity.principal' },
        {
          path: '/actorSnapshotRef',
          kind: 'OBJECT',
          objectType: 'zhiju.identity.actor_snapshot',
        },
        {
          path: '/authorizationDecisionRef',
          kind: 'OBJECT',
          objectType: 'zhiju.identity.authorization_decision',
        },
      ],
    });
    // The approved #157 PayloadGuard policy stays limited to the Source Slice
    // boundary: this Query declares no build-time guard of its own.
    expect(registry.getOperation(receiptType, '1.0')?.payloadGuardPolicyRef).toBeUndefined();
  });

  it('rejects divergent compatibility declarations for the receipt Query', () => {
    const metadata = JSON.parse(
      readFileSync(
        new URL('../../registry/operation-compatibility-metadata.v1.json', import.meta.url),
        'utf8',
      ),
    ) as {
      operations: {
        type: string;
        version: string;
        authorizationPurpose: string;
        dataClassification: string;
      }[];
    };
    expect(() => {
      assertResolutionReceiptCompatibilityMetadata(metadata.operations);
    }).not.toThrow();
    const entry = metadata.operations.find((item) => item.type === receiptType);
    if (entry === undefined) throw new Error('missing compatibility fixture');
    for (const field of ['authorizationPurpose', 'dataClassification'] as const) {
      expect(() => {
        assertResolutionReceiptCompatibilityMetadata(
          metadata.operations.map((item) => (item === entry ? { ...item, [field]: '*' } : item)),
        );
      }).toThrow('inconsistent');
    }
  });
});

// ===========================================================================
// #258 workspace directory Query — `project.find_workspace_projects@1.0`
// ===========================================================================

const directoryType = 'project.find_workspace_projects';

interface DirectoryNegativeCase {
  base: string;
  path: string;
  keyword: string;
  expectedPath: string;
  remove?: boolean;
  value?: unknown;
  params?: Record<string, unknown>;
}

function readDirectoryFixture(name: string): Fixture {
  return JSON.parse(
    readFileSync(
      new URL(
        `../../../tests/fixtures/contracts/workspace-directory/${name}.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  ) as Fixture;
}

const directoryNegativeCases = JSON.parse(
  readFileSync(
    new URL(
      '../../../tests/fixtures/contracts/workspace-directory/negative-cases.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as DirectoryNegativeCase[];

// The shared `setPath` helper rejects array nodes, so the directory cases use a
// local traversal that also walks array indices (e.g. `/items/0/status`).
function setDirectoryPath(input: Fixture, path: string, value: unknown, remove = false): void {
  const keys = path.split('/').slice(1);
  const key = keys.pop();
  if (key === undefined) throw new Error('missing fixture path');
  let parent = input as Record<string, unknown>;
  for (const name of keys) {
    const next = parent[name];
    if (next === null || typeof next !== 'object') throw new Error('missing fixture path');
    parent = next as Record<string, unknown>;
  }
  if (remove) Reflect.deleteProperty(parent, key);
  else parent[key] = value;
}

function validateDirectory(base: string, input: unknown) {
  return base === 'result'
    ? registry.validateOperationResult(directoryType, '1.0', input)
    : registry.validateOperation(directoryType, '1.0', input);
}

describe('workspace directory public contracts', () => {
  it('accepts the complete Query and page fixtures', () => {
    expect(validateDirectory('query', readDirectoryFixture('query'))).toEqual({
      valid: true,
      errors: [],
    });
    expect(validateDirectory('result', readDirectoryFixture('result'))).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('bounds the extended directoryCursor and accepts long legal continuations', () => {
    // #258 R5 option (a): `project.find_workspace_projects@1.0` extends the
    // cursor past the shared `opaqueCursor` (16..512) to 16..8192 so a
    // continuation can carry and re-observe the chain's served
    // identities/observations. The alphabet stays `^[A-Za-z0-9_-]+$` on both
    // the request `page.cursor` and the result `nextCursor`. The untouched
    // valid fixtures are the positive controls; the negatives are one too
    // short (minLength), a dotted value (pattern) and one character past the
    // declared bound (maxLength).
    const cursorCases = directoryNegativeCases.filter(
      (test) => test.base === 'result' && test.path === '/nextCursor',
    );
    expect(cursorCases.map((test) => [test.keyword, test.value])).toEqual([
      ['minLength', 'x'],
      ['pattern', 'opaque.cursor.value.0002'],
      ['maxLength', 'a'.repeat(8193)],
    ]);
    for (const length of [16, 512, 1024, 8192]) {
      const cursor = 'a'.repeat(length);
      const query = readDirectoryFixture('query');
      setDirectoryPath(query, '/payload/page/cursor', cursor);
      expect(validateDirectory('query', query)).toEqual({ valid: true, errors: [] });
      const result = readDirectoryFixture('result');
      setDirectoryPath(result, '/nextCursor', cursor);
      expect(validateDirectory('result', result)).toEqual({ valid: true, errors: [] });
    }
    expect(validateDirectory('result', readDirectoryFixture('result'))).toEqual({
      valid: true,
      errors: [],
    });
    for (const test of cursorCases) {
      const input = readDirectoryFixture('result');
      setDirectoryPath(input, test.path, test.value, test.remove);
      const outcome = validateDirectory('result', input);
      expect(outcome.valid).toBe(false);
      expect(outcome.errors).toContainEqual(
        expect.objectContaining({ keyword: test.keyword, instancePath: '/nextCursor' }),
      );
    }
  });

  it.each(directoryNegativeCases)('rejects $base $path ($keyword)', (test) => {
    const input = readDirectoryFixture(test.base);
    expect(validateDirectory(test.base, input)).toEqual({ valid: true, errors: [] });
    setDirectoryPath(input, test.path, test.value, test.remove);
    const outcome = validateDirectory(test.base, input);
    expect(outcome.valid).toBe(false);
    expect(outcome.errors).toContainEqual(
      expect.objectContaining({
        keyword: test.keyword,
        instancePath: test.expectedPath,
        ...(test.params === undefined ? {} : { params: expect.objectContaining(test.params) }),
      }),
    );
  });

  it('accepts the declared 1..50 pageSize boundary and the optional page fields', () => {
    for (const pageSize of [1, 50]) {
      const input = readDirectoryFixture('query');
      setDirectoryPath(input, '/payload/page', { pageSize });
      expect(validateDirectory('query', input)).toEqual({ valid: true, errors: [] });
    }
    const minimal = readDirectoryFixture('query');
    setDirectoryPath(minimal, '/payload', { page: { pageSize: 1 } });
    expect(validateDirectory('query', minimal)).toEqual({ valid: true, errors: [] });
    const emptyPage = readDirectoryFixture('result');
    setDirectoryPath(emptyPage, '/items', []);
    setDirectoryPath(emptyPage, '/nextCursor', 'opaque-cursor-value-0003');
    expect(validateDirectory('result', emptyPage)).toEqual({ valid: true, errors: [] });
  });

  it('exposes the declared self-discovery ScopeRef and exact registration metadata', () => {
    // The declared #258 exception: an empty scopeRef is accepted for this Query
    // alone because it is not added to operationScopeSchema()'s projectRequired
    // list, so its envelope keeps the plain shared ScopeRef.
    const envelope = operationEnvelopeSchema(operation(directoryType));
    expect(object(envelope.properties).scopeRef).toEqual({
      $ref: 'https://schemas.zhiju.local/common/1.0#/$defs/scopeRef',
    });
    expect(registry.getOperation(directoryType, '1.0')).toMatchObject({
      owner: 'enterprise-project',
      kind: 'QUERY',
      schemaStatus: 'FULL',
      allowedConsistency: ['AUTHORITATIVE'],
      authorizationPurpose: 'project.workspace.discover',
      dataClassification: 'INTERNAL',
    });
    expect(registry.getOperation(directoryType, '1.0')?.payloadGuardPolicyRef).toBeUndefined();
  });
});
