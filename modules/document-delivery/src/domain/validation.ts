/* eslint-disable no-control-regex -- Contract rules reject ASCII controls in names. */
import { isUuidV7 } from '@zhiju/shared-kernel';

import { fail } from './errors.js';
import { MVP_INPUT_LIMITS } from './policy.js';

export type JsonRecord = Readonly<Record<string, unknown>>;

export function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A closed JSON object: every present key is declared, every required key is
 * present exactly once. Missing optional keys stay omitted.
 */
export function closedObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): JsonRecord {
  if (!isPlainObject(value)) fail('INVALID_REQUEST');
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail('INVALID_REQUEST');
  for (const key of required) if (!(key in value)) fail('INVALID_REQUEST');
  return value;
}

export function exactKeys(value: unknown, keys: readonly string[]): JsonRecord {
  return closedObject(value, keys);
}

const UTF8 = new TextEncoder();

export function utf8Bytes(value: string): number {
  return UTF8.encode(value).length;
}

export function codePoints(value: string): number {
  return Array.from(value).length;
}

export function hasControlCharacters(value: string): boolean {
  return /[\x00-\x1f\x7f]/u.test(value);
}

export function hasNoteControlCharacters(value: string): boolean {
  // Note admits TAB, LF and CR only; every other control is rejected.
  return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value);
}

export function requiredString(
  value: unknown,
  maxBytes: number,
  options: { control: 'none' | 'note' } = { control: 'none' },
): string {
  if (typeof value !== 'string') fail('INVALID_REQUEST');
  const bytes = utf8Bytes(value);
  if (bytes < 1 || bytes > maxBytes || value.trim().length === 0) fail('INVALID_REQUEST');
  if (options.control === 'note') {
    if (hasNoteControlCharacters(value)) fail('INVALID_REQUEST');
  } else if (hasControlCharacters(value)) {
    fail('INVALID_REQUEST');
  }
  return value;
}

export function projectName(value: unknown): string {
  return requiredString(value, 512);
}

export function fileLabel(value: unknown, maxBytes: number): string {
  return requiredString(value, maxBytes);
}

export function noteText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const note = requiredString(value, 16384, { control: 'note' });
  if (codePoints(note) > 4096) fail('INVALID_REQUEST');
  return note;
}

export function safeInteger(value: unknown, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    fail('INVALID_REQUEST');
  return value;
}

export function positiveBytes(value: unknown): number {
  const bytes = safeInteger(value);
  if (bytes > MVP_INPUT_LIMITS.zipBytes) fail('INVALID_REQUEST');
  return bytes;
}

export function uuidV7(value: unknown): string {
  if (typeof value !== 'string' || !isUuidV7(value)) fail('INVALID_REQUEST');
  return value;
}

export function sha256Hex(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) fail('INVALID_REQUEST');
  return value;
}

export function queryLimit(value: unknown, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,2}$/u.test(value)) fail('INVALID_REQUEST');
  const parsed = Number(value);
  if (parsed > maximum) fail('INVALID_REQUEST');
  return parsed;
}

export function queryValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096)
    fail('INVALID_REQUEST');
  return value;
}

/** Only an exact UTC RFC 3339 instant serialized by `Date#toISOString`. */
export function instant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    fail('INVALID_REQUEST');
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) fail('INVALID_REQUEST');
  return value;
}

export function instantFromDatabase(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  fail('DEPENDENCY_UNAVAILABLE');
}

export function uniqueStrings(value: readonly string[]): readonly string[] {
  return [...new Set(value)];
}

export function asReasonCodes(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return [];
  return value as readonly string[];
}
