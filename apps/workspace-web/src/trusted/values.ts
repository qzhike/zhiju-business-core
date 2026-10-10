// Narrow `unknown` (parsed JSON, persisted values) into the small closed shapes
// the trusted journey accepts. Nothing here trusts a wire value: a field that
// does not satisfy its expected type is reported as absent so callers can fail
// closed instead of rendering an unvalidated value.

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as JsonRecord;
}

export function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asNonEmptyString(value: unknown): string | null {
  const text = asString(value);
  return text !== null && text.length > 0 ? text : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function field(record: JsonRecord, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}
