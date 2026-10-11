import type { KeyObject } from 'node:crypto';
import { parseJwt, verifyRs256 } from './jwt.js';
import type { ParsedJwt } from './jwt.js';
import { audienceIncludes, numericClaim, OidcRejectedError } from './oidc.js';
import type { BffTrustConfig } from './trust-config.js';

export type KeyResolver = (kid: string) => Promise<KeyObject>;

export interface VerifiedIdentity {
  issuer: string;
  subject: string;
}

function requireStringClaim(claims: Record<string, unknown>, key: string): string {
  const value = claims[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new OidcRejectedError(`token ${key} missing`);
  }
  return value;
}

function requireStringArrayClaim(claims: Record<string, unknown>, key: string): string[] {
  const value = claims[key];
  if (typeof value === 'string' && value.length > 0) return [value];
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'string')
  ) {
    return value;
  }
  throw new OidcRejectedError(`token ${key} missing`);
}

/** aud with more than one value requires an authorized party per OIDC Core. */
function requireAllowedAuthorizedParty(claims: Record<string, unknown>, allowedAzp: string): void {
  const audiences = requireStringArrayClaim(claims, 'aud');
  const azp = claims.azp;
  if (audiences.length > 1 && azp === undefined) {
    throw new OidcRejectedError('token azp missing');
  }
  if (azp !== undefined && azp !== allowedAzp) {
    throw new OidcRejectedError('token azp rejected');
  }
}

async function verifySignature(
  token: string,
  algorithms: readonly string[],
  keys: KeyResolver,
): Promise<ParsedJwt> {
  const parsed = parseJwt(token);
  const algorithm = parsed.header.alg;
  if (typeof algorithm !== 'string' || !algorithms.includes(algorithm)) {
    throw new OidcRejectedError('token algorithm rejected');
  }
  const kid = parsed.header.kid;
  if (typeof kid !== 'string' || kid.length === 0) throw new OidcRejectedError('token kid missing');
  const key = await keys(kid);
  if (!verifyRs256(parsed, key)) throw new OidcRejectedError('token signature invalid');
  return parsed;
}

export async function verifyIdToken(input: {
  token: string;
  config: BffTrustConfig;
  keys: KeyResolver;
  now: number;
  nonce?: string;
  /** Refresh responses carry no authorization nonce; the caller must opt out. */
  skipNonce?: boolean;
}): Promise<ParsedJwt> {
  const { token, config, keys, now } = input;
  const parsed = await verifySignature(token, config.idTokenAlgorithms, keys);
  const claims = parsed.claims;
  if (claims.iss !== config.issuer) throw new OidcRejectedError('id token issuer mismatch');
  if (!audienceIncludes(claims, config.clientId)) {
    throw new OidcRejectedError('id token audience mismatch');
  }
  requireAllowedAuthorizedParty(claims, config.allowedAzp);
  if (input.skipNonce !== true) {
    if (typeof input.nonce !== 'string') throw new OidcRejectedError('id token nonce unavailable');
    if (claims.nonce !== input.nonce) throw new OidcRejectedError('id token nonce mismatch');
  }
  requireStringClaim(claims, 'sub');
  const skew = config.clockSkewSeconds;
  const nowSeconds = Math.floor(now / 1000);
  const expiresAt = numericClaim(claims, 'exp');
  const issuedAt = numericClaim(claims, 'iat');
  if (expiresAt === undefined || issuedAt === undefined || expiresAt <= issuedAt) {
    throw new OidcRejectedError('id token lifetime invalid');
  }
  if (nowSeconds > expiresAt + skew) throw new OidcRejectedError('id token expired');
  if (issuedAt - skew > nowSeconds) throw new OidcRejectedError('id token issued in the future');
  return parsed;
}

export async function verifyAccessToken(input: {
  token: string;
  config: BffTrustConfig;
  keys: KeyResolver;
  now: number;
}): Promise<ParsedJwt> {
  const { token, config, keys, now } = input;
  const parsed = await verifySignature(token, config.accessTokenAlgorithms, keys);
  const claims = parsed.claims;
  if (claims.typ !== 'Bearer') throw new OidcRejectedError('access token type rejected');
  if (claims.iss !== config.issuer) throw new OidcRejectedError('access token issuer mismatch');
  if (!audienceIncludes(claims, config.apiAudience)) {
    throw new OidcRejectedError('access token audience mismatch');
  }
  requireAllowedAuthorizedParty(claims, config.allowedAzp);
  requireStringClaim(claims, 'sub');
  const skew = config.clockSkewSeconds;
  const nowSeconds = Math.floor(now / 1000);
  const expiresAt = numericClaim(claims, 'exp');
  const issuedAt = numericClaim(claims, 'iat');
  if (expiresAt === undefined || issuedAt === undefined) {
    throw new OidcRejectedError('access token lifetime missing');
  }
  const notBefore = numericClaim(claims, 'nbf');
  if (notBefore !== undefined && nowSeconds < notBefore - skew) {
    throw new OidcRejectedError('access token not yet valid');
  }
  if (nowSeconds > expiresAt + skew) throw new OidcRejectedError('access token expired');
  if (issuedAt - skew > nowSeconds)
    throw new OidcRejectedError('access token issued in the future');
  if (expiresAt - issuedAt > config.accessTokenMaxAgeSeconds) {
    throw new OidcRejectedError('access token lifetime too long');
  }
  return parsed;
}

/** The access token must describe the very same (iss, sub) as the ID token. */
export function verifiedIdentity(idToken: ParsedJwt, accessToken: ParsedJwt): VerifiedIdentity {
  const issuer = idToken.claims.iss;
  const subject = idToken.claims.sub;
  if (typeof issuer !== 'string' || typeof subject !== 'string') {
    throw new OidcRejectedError('identity claims missing');
  }
  if (accessToken.claims.iss !== issuer || accessToken.claims.sub !== subject) {
    throw new OidcRejectedError('token subject mismatch');
  }
  return { issuer, subject };
}
