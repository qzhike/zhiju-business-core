// Identifier and operation-path primitives for the trusted journey.
//
// The public Query envelope binds `queryId`/`correlationId` to canonical UUIDv7
// (`contracts/src/common.schema.ts`) and addresses an operation only by its
// exact lowercase dotted namespace plus `<major>.<minor>` version. Both are
// generated and validated here so the browser never invents a path, an
// operation name, or an id the owning contract would reject.

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OPERATION = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/u;
const VERSION = /^\d+\.\d+$/u;

export function isUuidV7(value: string): boolean {
  return UUID_V7.test(value);
}

export function isQueryOperation(value: string): boolean {
  return OPERATION.test(value) && !value.includes('%');
}

export function isQueryVersion(value: string): boolean {
  return VERSION.test(value);
}

/**
 * RFC 9562 UUIDv7: 48-bit big-endian Unix-ms timestamp, 4-bit version, 12 bits
 * of randomness, variant `10`, 62 bits of randomness. Uniqueness inside one
 * millisecond comes from the random bits, so no clock state is shared.
 */
export function uuidV7(now: number = Date.now(), random?: Uint8Array): string {
  const bytes = new Uint8Array(16);
  const timestamp = BigInt(Math.max(0, Math.floor(now)));
  for (let index = 0; index < 6; index += 1) {
    bytes[index] = Number((timestamp >> BigInt(8 * (5 - index))) & 0xffn);
  }
  const source = random ?? crypto.getRandomValues(new Uint8Array(10));
  for (let index = 0; index < 10; index += 1) {
    bytes[6 + index] = source[index] ?? 0;
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export function nowInstant(): string {
  return new Date().toISOString();
}

/**
 * The BFF route is `POST /bff/queries/{operation}/{version}` and forbids
 * percent-encoding, so both segments are validated before they are joined.
 */
export function queryRoute(operation: string, version: string): string {
  if (!isQueryOperation(operation) || !isQueryVersion(version)) {
    throw new Error('UI_CLIENT_STATE_INVALID');
  }
  return `/bff/queries/${operation}/${version}`;
}
