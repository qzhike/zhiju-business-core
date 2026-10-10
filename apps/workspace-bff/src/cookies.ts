import { hasControlCharacters } from './support.js';

/**
 * Minimal dependency-free Cookie handling. Host-prefixed cookies (`__Host-`)
 * carry no Domain attribute, are Secure, HttpOnly and Path=/ so a browser can
 * only ever send them to the fixed public origin.
 */
export const SESSION_COOKIE = '__Host-zhiju_session';
export const LOGIN_COOKIE = '__Host-zhiju_login';

export interface CookieAttributes {
  maxAgeSeconds?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict';
  path?: string;
}

export function serializeCookie(
  name: string,
  value: string,
  attributes: CookieAttributes = {},
): string {
  const parts = [`${name}=${value}`];
  parts.push(`Path=${attributes.path ?? '/'}`);
  if (attributes.secure !== false) parts.push('Secure');
  if (attributes.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${attributes.sameSite ?? 'Lax'}`);
  if (attributes.maxAgeSeconds !== undefined) parts.push(`Max-Age=${attributes.maxAgeSeconds}`);
  return parts.join('; ');
}

export function clearCookie(name: string): string {
  return serializeCookie(name, '', { maxAgeSeconds: 0 });
}

export type SingleCookieResult =
  { status: 'ok'; value: string | undefined } | { status: 'malformed' } | { status: 'duplicate' };

/**
 * Reads exactly one value for `name`. A duplicated or malformed Cookie header
 * (or a duplicated name) is rejected instead of silently taking a winner.
 */
export function readSingleCookie(header: string | undefined, name: string): SingleCookieResult {
  if (header === undefined) return { status: 'ok', value: undefined };
  const matches: string[] = [];
  for (const part of header.split(';')) {
    const segment = part.trim();
    if (segment.length === 0) continue;
    const separator = segment.indexOf('=');
    if (separator <= 0) return { status: 'malformed' };
    const key = segment.slice(0, separator).trim();
    if (key.length === 0) return { status: 'malformed' };
    if (key !== name) continue;
    const raw = segment.slice(separator + 1).trim();
    if (raw.length === 0) return { status: 'malformed' };
    if (raw.includes('"') || raw.includes(',') || raw.includes(';') || hasControlCharacters(raw)) {
      return { status: 'malformed' };
    }
    matches.push(raw);
  }
  if (matches.length === 0) return { status: 'ok', value: undefined };
  if (matches.length > 1) return { status: 'duplicate' };
  return { status: 'ok', value: matches[0] };
}

export function appendSetCookie(
  reply: {
    getHeader(name: string): unknown;
    header(name: string, value: string | string[]): unknown;
  },
  value: string,
): void {
  const existing = reply.getHeader('set-cookie');
  if (existing === undefined) {
    reply.header('set-cookie', value);
    return;
  }
  const list = Array.isArray(existing)
    ? existing.filter((entry): entry is string => typeof entry === 'string')
    : typeof existing === 'string'
      ? [existing]
      : [];
  reply.header('set-cookie', [...list, value]);
}
