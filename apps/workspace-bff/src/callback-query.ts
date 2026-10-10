import { hasControlCharacters } from './support.js';
import type { BffTrustConfig } from './trust-config.js';

/** Pure callback-query validation: no side effects, no values echoed back. */
export class CallbackRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CallbackRequestError';
  }
}

export interface CallbackSuccess {
  kind: 'success';
  code: string;
  state: string;
  iss: string;
  sessionState: string | undefined;
}

export interface CallbackOidcError {
  kind: 'oidc-error';
  error: string;
  state: string;
  iss: string;
  errorDescription: string | undefined;
  errorUri: string | undefined;
  sessionState: string | undefined;
}

export type CallbackQuery = CallbackSuccess | CallbackOidcError;

const RAW_QUERY_MAX_BYTES = 16 * 1024;

/** Decoded byte limits per parameter, from the accepted callback shapes. */
const PARAMETER_LIMITS: Record<string, number> = {
  code: 4096,
  state: 256,
  error: 256,
  iss: 2048,
  error_description: 2048,
  error_uri: 2048,
  session_state: 1024,
};

const SUCCESS_KEYS: Record<string, true> = {
  code: true,
  state: true,
  iss: true,
  session_state: true,
};
const ERROR_KEYS: Record<string, true> = {
  error: true,
  state: true,
  iss: true,
  error_description: true,
  error_uri: true,
  session_state: true,
};

/** Decodes exactly once as application/x-www-form-urlencoded, rejecting bad bytes. */
function decodeFormUrlEncoded(value: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charAt(index);
    if (char === '+') {
      bytes.push(0x20);
      continue;
    }
    if (char === '%') {
      const hex = value.slice(index + 1, index + 3);
      if (!/^[0-9a-fA-F]{2}$/u.test(hex)) throw new CallbackRequestError('invalid encoding');
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
      continue;
    }
    const codePoint = value.codePointAt(index) ?? 0;
    for (const byte of Buffer.from(String.fromCodePoint(codePoint), 'utf8')) bytes.push(byte);
    if (codePoint > 0xffff) index += 1;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(bytes));
  } catch {
    throw new CallbackRequestError('invalid encoding');
  }
}

function collectParameters(rawQuery: string): Record<string, string> {
  if (Buffer.byteLength(rawQuery, 'utf8') > RAW_QUERY_MAX_BYTES) {
    throw new CallbackRequestError('query too large');
  }
  const parameters: Record<string, string> = {};
  for (const segment of rawQuery.split('&')) {
    if (segment.length === 0) continue;
    const separator = segment.indexOf('=');
    const key = decodeFormUrlEncoded(separator === -1 ? segment : segment.slice(0, separator));
    const value = separator === -1 ? '' : decodeFormUrlEncoded(segment.slice(separator + 1));
    if (key.length === 0) throw new CallbackRequestError('empty parameter name');
    if (hasControlCharacters(key) || hasControlCharacters(value)) {
      throw new CallbackRequestError('control character');
    }
    if (Object.hasOwn(parameters, key)) throw new CallbackRequestError('duplicate parameter');
    const limit = PARAMETER_LIMITS[key];
    if (limit === undefined) throw new CallbackRequestError('unknown parameter');
    if (Buffer.byteLength(value, 'utf8') > limit) throw new CallbackRequestError('value too large');
    parameters[key] = value;
  }
  return parameters;
}

function requireValue(parameters: Record<string, string>, key: string): string {
  const value = parameters[key];
  if (value === undefined || value.length === 0) throw new CallbackRequestError(`missing ${key}`);
  return value;
}

/**
 * Accepts exactly the two callback shapes from the Delta. Any unknown key,
 * duplicate key (even with an equal value), empty required value, bad encoding,
 * control character or over-limit value is a safe 400 with zero side effects.
 */
export function parseCallbackQuery(rawQuery: string): CallbackQuery {
  const parameters = collectParameters(rawQuery);
  const hasCode = Object.hasOwn(parameters, 'code');
  const hasError = Object.hasOwn(parameters, 'error');
  if (hasCode && hasError) throw new CallbackRequestError('ambiguous callback');
  const known = hasCode ? SUCCESS_KEYS : hasError ? ERROR_KEYS : undefined;
  if (known === undefined) throw new CallbackRequestError('callback missing code or error');
  for (const key of Object.keys(parameters)) {
    if (!Object.hasOwn(known, key)) throw new CallbackRequestError('unknown parameter');
  }
  const state = requireValue(parameters, 'state');
  const iss = requireValue(parameters, 'iss');
  const sessionState = parameters.session_state;
  if (sessionState?.length === 0) {
    throw new CallbackRequestError('empty session_state');
  }
  if (hasCode) {
    return { kind: 'success', code: requireValue(parameters, 'code'), state, iss, sessionState };
  }
  const errorUri = parameters.error_uri;
  if (errorUri?.length === 0) {
    throw new CallbackRequestError('empty error_uri');
  }
  return {
    kind: 'oidc-error',
    error: requireValue(parameters, 'error'),
    state,
    iss,
    errorDescription: parameters.error_description,
    errorUri,
    sessionState,
  };
}

function matchesReturnRoute(patterns: readonly string[], path: string): boolean {
  const pathSegments = path.split('/').slice(1);
  return patterns.some((pattern) => {
    const patternSegments = pattern.split('/').slice(1);
    for (let index = 0; index < patternSegments.length; index += 1) {
      const expected = patternSegments[index];
      if (expected === '*') return index === patternSegments.length - 1;
      const actual = pathSegments[index];
      if (actual === undefined || actual.length === 0) return false;
      if (expected !== undefined && expected.startsWith(':') && expected.length > 1) continue;
      if (expected !== actual) return false;
    }
    return patternSegments.length === pathSegments.length;
  });
}

/**
 * A return route must be one of the configured same-origin page paths plus an
 * optional safe query; schemes, `//`, backslashes and traversal are rejected.
 */
export function resolveReturnTo(config: BffTrustConfig, value: string | undefined): string {
  const candidate = value === undefined || value.length === 0 ? '/workbench' : value;
  if (!candidate.startsWith('/') || candidate.startsWith('//')) {
    throw new CallbackRequestError('unsafe return route');
  }
  if (candidate.includes('\\') || hasControlCharacters(candidate)) {
    throw new CallbackRequestError('unsafe return route');
  }
  const cut = candidate.search(/[?#]/u);
  const path = cut === -1 ? candidate : candidate.slice(0, cut);
  const suffix = cut === -1 ? '' : candidate.slice(cut);
  if (path.includes('..') || suffix.includes('\\')) {
    throw new CallbackRequestError('unsafe return route');
  }
  if (!matchesReturnRoute(config.returnRoutePatterns, path)) {
    throw new CallbackRequestError('return route not allowed');
  }
  return `${path}${suffix}`;
}
