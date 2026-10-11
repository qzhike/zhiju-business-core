import { constantTimeEquals, randomToken } from './support.js';

export const JSON_CONTENT_TYPE = 'application/json';
export const ZIP_CONTENT_TYPE = 'application/zip';

export function issueCsrfToken(): string {
  return randomToken(32);
}

export function csrfMatches(expected: string, provided: string | undefined): boolean {
  if (provided === undefined) return false;
  return constantTimeEquals(expected, provided);
}

export function hostAllowed(
  allowedHosts: readonly string[],
  hostHeader: string | undefined,
): boolean {
  if (hostHeader === undefined) return false;
  const host = hostHeader.trim().toLowerCase();
  if (host.length === 0) return false;
  return allowedHosts.some((allowed) => allowed.toLowerCase() === host);
}

export function originAllowed(publicOrigin: string, originHeader: string | undefined): boolean {
  if (originHeader === undefined) return false;
  return originHeader === publicOrigin;
}

/** Accepts `application/json` with optional parameters, rejects anything else. */
export function contentTypeAllowed(header: string | undefined, expected: string): boolean {
  if (header === undefined) return false;
  const [mediaType] = header.split(';');
  if (mediaType === undefined) return false;
  return mediaType.trim().toLowerCase() === expected;
}
