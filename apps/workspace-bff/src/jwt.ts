import { createPublicKey, createVerify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

export const MAX_JWT_BYTES = 16 * 1024;

export type JwtClaims = Record<string, unknown>;

export interface ParsedJwt {
  raw: string;
  header: Record<string, unknown>;
  claims: JwtClaims;
  signingInput: string;
  signature: Buffer;
}

export class JwtRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JwtRejectedError';
  }
}

function decodeSegment(segment: string): unknown {
  const bytes = Buffer.from(segment, 'base64url');
  return JSON.parse(bytes.toString('utf8')) as unknown;
}

/**
 * Parses a compact JWS with hard size bounds. `jku`/`x5u` are never honored:
 * a token that requests an alternate key source is rejected outright.
 */
export function parseJwt(token: string): ParsedJwt {
  if (Buffer.byteLength(token, 'utf8') > MAX_JWT_BYTES) {
    throw new JwtRejectedError('token too large');
  }
  const segments = token.split('.');
  if (segments.length !== 3) throw new JwtRejectedError('malformed token');
  const [headerSegment, claimsSegment, signatureSegment] = segments as [string, string, string];
  if (headerSegment.length === 0 || claimsSegment.length === 0 || signatureSegment.length === 0) {
    throw new JwtRejectedError('malformed token');
  }
  let header: unknown;
  let claims: unknown;
  try {
    header = decodeSegment(headerSegment);
    claims = decodeSegment(claimsSegment);
  } catch {
    throw new JwtRejectedError('malformed token');
  }
  if (typeof header !== 'object' || header === null || Array.isArray(header)) {
    throw new JwtRejectedError('malformed header');
  }
  if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) {
    throw new JwtRejectedError('malformed claims');
  }
  const headerRecord = header as Record<string, unknown>;
  if (headerRecord.jku !== undefined || headerRecord.x5u !== undefined) {
    throw new JwtRejectedError('alternate key source rejected');
  }
  const algorithm = headerRecord.alg;
  if (typeof algorithm !== 'string') throw new JwtRejectedError('missing algorithm');
  const type = headerRecord.typ;
  if (type !== undefined && type !== 'JWT') throw new JwtRejectedError('unexpected token type');
  const kid = headerRecord.kid;
  if (typeof kid !== 'string' || kid.length === 0) throw new JwtRejectedError('missing key id');

  return {
    raw: token,
    header: headerRecord,
    claims: claims as JwtClaims,
    signingInput: `${headerSegment}.${claimsSegment}`,
    signature: Buffer.from(signatureSegment, 'base64url'),
  };
}

export function publicKeyFromJwk(jwk: Record<string, unknown>): KeyObject | undefined {
  if (jwk.kty !== 'RSA') return undefined;
  const modulus = jwk.n;
  const exponent = jwk.e;
  if (typeof modulus !== 'string' || typeof exponent !== 'string') return undefined;
  const use = jwk.use;
  if (use !== undefined && use !== 'sig') return undefined;
  const algorithm = jwk.alg;
  if (algorithm !== undefined && algorithm !== 'RS256') return undefined;
  try {
    return createPublicKey({ key: { kty: 'RSA', n: modulus, e: exponent }, format: 'jwk' });
  } catch {
    return undefined;
  }
}

export function verifyRs256(jwt: ParsedJwt, key: KeyObject): boolean {
  if (jwt.header.alg !== 'RS256') return false;
  try {
    return createVerify('RSA-SHA256').update(jwt.signingInput).verify(key, jwt.signature);
  } catch {
    return false;
  }
}
