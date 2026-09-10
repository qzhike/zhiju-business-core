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
  pagination: Record<string, unknown> & { padding: string[] };
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
    else input.pagination = { padding };
    // Independent fixture sizing uses native JSON serialization, not the guard's counter.
    while (Buffer.byteLength(JSON.stringify(input), 'utf8') < bytes) {
      const before = Buffer.byteLength(JSON.stringify(input), 'utf8');
      const index = padding.length;
      const prefix = base === 'capture' ? `kind_${index}_` : '';
      padding.push(prefix);
      const remaining = bytes - Buffer.byteLength(JSON.stringify(input), 'utf8');
      const perChar = Buffer.byteLength(JSON.stringify(character), 'utf8') - 2;
      const count = Math.min(15000, Math.floor(remaining / perChar));
      if (count < 0) throw new Error('fixture padding overshot');
      padding[index] =
        String(padding[index]) +
        character.repeat(count) +
        'a'.repeat(Math.min(remaining - count * perChar, perChar - 1));
      if (Buffer.byteLength(JSON.stringify(input), 'utf8') === before)
        throw new Error('fixture padding made no progress');
    }
    expect(Buffer.byteLength(JSON.stringify(input), 'utf8')).toBe(bytes);
    return input;
  }
  for (const base of ['capture', 'query', 'result']) {
    for (const character of base === 'capture' ? ['a'] : ['a', '中', '😀', '\\', '\n']) {
      it(`enforces exact ${base} byte boundary for ${JSON.stringify(character)}`, () => {
        const limit = base === 'result' ? 4194304 : 262144;
        const input = padToBytes(base, limit, character);
        expect(validate(base, input)).toEqual({ valid: true, errors: [] });
        const padding =
          base === 'result'
            ? input.slice.source.factItems
            : base === 'capture'
              ? input.payload.requestedKinds
              : input.pagination.padding;
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
    input.pagination = { padding: [], text: 'a'.repeat(16385) };
    expect(validateEnvelope(input)).toBe(false);
    expect(validateEnvelope.errors).toContainEqual(
      expect.objectContaining({ keyword: 'payloadGuard', instancePath: '/pagination/text' }),
    );
    expect(payloadGuardErrors(input, policy, 'envelope')).toEqual([
      expect.objectContaining({ instancePath: '/pagination/text' }),
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
