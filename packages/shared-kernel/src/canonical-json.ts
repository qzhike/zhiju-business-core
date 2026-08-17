import { createHash } from 'node:crypto';

export type CanonicalJsonPrimitive = boolean | number | string | null;
export interface CanonicalJsonArray extends ReadonlyArray<CanonicalJsonValue> {}
export interface CanonicalJsonObject {
  readonly [key: string]: CanonicalJsonValue;
}
export type CanonicalJsonValue = CanonicalJsonPrimitive | CanonicalJsonArray | CanonicalJsonObject;

function isCanonicalJsonArray(value: CanonicalJsonValue): value is CanonicalJsonArray {
  return Array.isArray(value);
}

function isCanonicalJsonObject(value: CanonicalJsonValue): value is CanonicalJsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function normalize(value: CanonicalJsonValue, path: string): CanonicalJsonValue {
  if (value === null || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.normalize('NFC');
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new TypeError(`${path} must be a finite safe integer; decimals use strings`);
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (isCanonicalJsonArray(value)) {
    return value.map((item, index) => normalize(item, `${path}[${index}]`));
  }

  const normalizedEntries = Object.entries(value).map(([rawKey, item]) => {
    const key = rawKey.normalize('NFC');
    return [key, normalize(item, `${path}.${key}`)] as const;
  });
  const keys = normalizedEntries.map(([key]) => key);
  if (new Set(keys).size !== keys.length) {
    throw new TypeError(`${path} contains property names that collide after NFC normalization`);
  }

  normalizedEntries.sort(([left], [right]) => compareUtf8(left, right));
  return Object.fromEntries(normalizedEntries);
}

export function canonicalize(value: CanonicalJsonValue): string {
  return JSON.stringify(normalize(value, '$'));
}

export function sha256CanonicalJson(value: CanonicalJsonValue): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}

export function withoutOwnPayloadHash(value: CanonicalJsonValue): CanonicalJsonValue {
  if (!isCanonicalJsonObject(value)) {
    throw new TypeError('contract payload must be an object');
  }

  const header = value.header;
  if (header === undefined || !isCanonicalJsonObject(header)) {
    return value;
  }

  const restHeader = Object.fromEntries(
    Object.entries(header).filter(([key]) => key !== 'payloadHash'),
  );
  return { ...value, header: restHeader };
}

export function hashContractPayload(value: CanonicalJsonValue): string {
  return sha256CanonicalJson(withoutOwnPayloadHash(value));
}
