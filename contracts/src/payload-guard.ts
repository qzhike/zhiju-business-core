import type { ErrorObject, KeywordDefinition } from 'ajv';
import type { PayloadGuardPolicyRef } from './schema-types.js';

export interface PayloadGuardPolicy extends PayloadGuardPolicyRef {
  readonly maxEnvelopeBytes: number;
  readonly maxResultBytes: number;
  readonly maxStringCodePoints: number;
  readonly maxArrayItems: number;
  readonly maxObjectProperties: number;
  readonly maxDepth: number;
  readonly maxRequestedKinds: number;
}

const limits = [
  'maxEnvelopeBytes',
  'maxResultBytes',
  'maxStringCodePoints',
  'maxArrayItems',
  'maxObjectProperties',
  'maxDepth',
  'maxRequestedKinds',
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function loadPayloadGuardPolicies(input: unknown): ReadonlyMap<string, PayloadGuardPolicy> {
  if (!record(input) || Object.keys(input).length !== 1 || !Array.isArray(input.policies)) {
    throw new Error('invalid payload guard policy registry');
  }
  const policies = new Map<string, PayloadGuardPolicy>();
  for (const entry of input.policies as unknown[]) {
    if (
      !record(entry) ||
      typeof entry.type !== 'string' ||
      !/^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/.test(entry.type) ||
      entry.version !== '1.0' ||
      Object.keys(entry).length !== limits.length + 2 ||
      limits.some((key) => !Number.isSafeInteger(entry[key]) || Number(entry[key]) <= 0)
    ) {
      throw new Error('invalid payload guard policy');
    }
    const key = `${entry.type}@${entry.version}`;
    if (policies.has(key)) throw new Error('duplicate payload guard policy');
    policies.set(key, Object.freeze({ ...entry }) as unknown as PayloadGuardPolicy);
  }
  return policies;
}

export function resolvePayloadGuardPolicy(
  policies: ReadonlyMap<string, PayloadGuardPolicy>,
  ref: unknown,
): PayloadGuardPolicy {
  if (
    !record(ref) ||
    Object.keys(ref).length !== 2 ||
    typeof ref.type !== 'string' ||
    typeof ref.version !== 'string'
  ) {
    throw new Error('invalid payload guard policy reference');
  }
  const policy = policies.get(`${ref.type}@${ref.version}`);
  if (policy === undefined) throw new Error('unknown payload guard policy');
  return policy;
}

function violation(path: string, rule: string, limit?: number): ErrorObject[] {
  return [
    {
      keyword: 'payloadGuard',
      instancePath: path,
      schemaPath: '#/payloadGuard',
      params: { rule, ...(limit === undefined ? {} : { limit }) },
      message: 'payload guard rejected input',
    },
  ];
}

function pointer(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** Bound traversal before structural validation; never serialize a caller-controlled object. */
export function payloadGuardErrors(
  input: unknown,
  policy: PayloadGuardPolicy,
  mode: 'envelope' | 'result',
): ErrorObject[] {
  const byteLimit = mode === 'envelope' ? policy.maxEnvelopeBytes : policy.maxResultBytes;
  let bytes = 0;
  const active = new Set<object>();
  type Frame = { value: unknown; path: string; depth: number } | { leave: object };
  const stack: Frame[] = [{ value: input, path: '', depth: 0 }];
  const stringErrors = (value: string, path: string): ErrorObject[] => {
    let count = 0;
    for (let offset = 0; offset < value.length;) {
      offset += (value.codePointAt(offset) ?? 0) > 0xffff ? 2 : 1;
      if (++count > policy.maxStringCodePoints)
        return violation(path, 'maxStringCodePoints', policy.maxStringCodePoints);
    }
    bytes += Buffer.byteLength(JSON.stringify(value), 'utf8');
    return [];
  };
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    if ('leave' in frame) {
      active.delete(frame.leave);
      continue;
    }
    const { value, path, depth } = frame;
    if (typeof value === 'string') {
      const errors = stringErrors(value, path);
      if (errors.length > 0) return errors;
    } else if (
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      bytes += Buffer.byteLength(JSON.stringify(value), 'utf8');
    } else if (typeof value === 'object') {
      if (active.has(value)) return violation(path, 'jsonValue');
      if (depth + 1 > policy.maxDepth) return violation(path, 'maxDepth', policy.maxDepth);
      const isArray = Array.isArray(value);
      const prototype: unknown = Object.getPrototypeOf(value);
      if (
        isArray
          ? prototype !== Array.prototype
          : prototype !== Object.prototype && prototype !== null
      )
        return violation(path, 'jsonValue');
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => typeof key !== 'string')) return violation(path, 'jsonValue');
      const names = keys as string[];
      const children: { key: string; value: unknown }[] = [];
      if (isArray) {
        if (value.length > policy.maxArrayItems)
          return violation(path, 'maxArrayItems', policy.maxArrayItems);
        if (names.length !== value.length + 1) return violation(path, 'jsonValue');
        for (let i = 0; i < value.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable)
            return violation(`${path}/${i}`, 'jsonValue');
          children.push({ key: String(i), value: descriptor.value as unknown });
        }
      } else {
        if (names.length > policy.maxObjectProperties)
          return violation(path, 'maxObjectProperties', policy.maxObjectProperties);
        for (const key of names) {
          const childPath = `${path}/${pointer(key)}`;
          const errors = stringErrors(key, childPath);
          if (errors.length > 0) return errors;
          if (bytes > byteLimit)
            return violation(
              '',
              mode === 'envelope' ? 'maxEnvelopeBytes' : 'maxResultBytes',
              byteLimit,
            );
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (descriptor === undefined) return violation(childPath, 'jsonValue');
          if (!('value' in descriptor) || !descriptor.enumerable)
            return violation(childPath, 'jsonValue');
          children.push({ key, value: descriptor.value as unknown });
        }
        bytes += names.length; // Colons between object keys and values.
      }
      bytes += 2 + Math.max(0, children.length - 1); // Brackets/braces and commas.
      active.add(value);
      stack.push({ leave: value });
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        if (child === undefined) continue;
        stack.push({ value: child.value, path: `${path}/${pointer(child.key)}`, depth: depth + 1 });
      }
    } else return violation(path, 'jsonValue');
    if (bytes > byteLimit)
      return violation('', mode === 'envelope' ? 'maxEnvelopeBytes' : 'maxResultBytes', byteLimit);
  }
  return [];
}

export function payloadGuardKeyword(
  policies: ReadonlyMap<string, PayloadGuardPolicy>,
): KeywordDefinition {
  return {
    keyword: 'payloadGuard',
    schemaType: 'object',
    errors: true,
    metaSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'version'],
      properties: { type: { type: 'string' }, version: { type: 'string' } },
    },
    compile(ref: unknown, parent: Record<string, unknown>) {
      const policy = resolvePayloadGuardPolicy(policies, ref);
      const mode =
        typeof parent.$id === 'string' && parent.$id.includes('/api/') ? 'envelope' : 'result';
      const validate = (data: unknown): boolean => {
        validate.errors = payloadGuardErrors(data, policy, mode);
        return validate.errors.length === 0;
      };
      validate.errors = [] as ErrorObject[];
      return validate;
    },
  };
}
