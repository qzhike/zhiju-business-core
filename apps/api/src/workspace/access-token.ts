// IM-UI-01 (#258): the Core access-token verifier of the workspace trusted
// Human entry. Session Delta §1/§2 fix its behaviour: Core never accepts a
// Browser "verified" hint, it fetches signing keys only from the
// discovery-driven allowlisted endpoints of the deployment document, and it
// derives the whole `VerifiedOidcContext` itself — issuer, subject, audience,
// azp, token digest, instants and the BFF session-binding digest.
//
// A failure is either an active rejection (401 `AUTHENTICATION_REQUIRED`: bad
// token, unknown key, wrong claim) or an unavailable dependency (503
// `DEPENDENCY_UNAVAILABLE`: discovery/JWKS unreachable with no usable cached
// key). There is no fallback identity, no cached "last known good" subject and
// no key taken from a token-supplied `jku`/`x5u` URL.

import {
  createHash,
  createPublicKey,
  createVerify,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto';

import type { VerifiedOidcContextInput } from '@zhiju/identity-policy';
import { sha256CanonicalJson } from '@zhiju/shared-kernel';

import { CORE_ERROR_CODE, CORE_ERROR_TABLE, type CoreErrorCode } from './errors.js';

export type AccessTokenFetchLike = typeof fetch;

/** Hard cap of a compact JWS accepted as an access token (Session Delta §1). */
export const ACCESS_TOKEN_MAX_BYTES = 16 * 1024;
const MAX_OIDC_JSON_BYTES = 64 * 1024;
const MAX_JWKS_KEYS = 64;
/** An unknown `kid` triggers at most one key refresh per window. */
const MIN_KEY_REFRESH_INTERVAL_MS = 30_000;
/** The BFF session binding is `>= 32` random bytes; its header is base64url. */
export const MIN_SESSION_BINDING_BYTES = 32;
const MAX_SESSION_BINDING_BYTES = 1024;
const MAX_SESSION_BINDING_HEADER_CHARS = 1400;
const MAX_SID_CHARS = 1024;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

export const SESSION_BINDING_HEADER = 'x-workspace-session-binding';
export const TRUST_CONFIG_HASH_HEADER = 'x-workspace-trust-config-hash';

/**
 * Headers a Browser must never smuggle through the trusted peer: the actor,
 * the Principal and the authorization Decision are produced server-side from
 * the verified token and the current IdentityPolicy state (Session Delta §6,
 * trace TR-258-04). Their presence is a safe request error, never a silently
 * ignored field.
 */
export const FORBIDDEN_BROWSER_OVERRIDE_HEADERS: readonly string[] = Object.freeze([
  'x-actor',
  'x-principal',
  'x-acting-for',
  'x-authorization-decision',
  'x-workspace-principal',
  'x-workspace-actor',
]);

/** The frozen verified OIDC context; it *is* the IdentityPolicy entry input. */
export type VerifiedOidcContext = VerifiedOidcContextInput;

export interface AccessTokenVerified {
  readonly ok: true;
  readonly context: VerifiedOidcContext;
}

export interface AccessTokenRejected {
  readonly ok: false;
  readonly code: string;
  readonly status: number;
}

export type AccessTokenVerification = AccessTokenVerified | AccessTokenRejected;

export type WorkspaceHeaderValue = string | readonly string[] | undefined;
export type WorkspaceHeaders = Readonly<Record<string, WorkspaceHeaderValue>>;

export interface WorkspaceSessionBinding {
  readonly ok: true;
  readonly sessionBinding: Buffer;
}

export type WorkspaceSessionBindingResult = WorkspaceSessionBinding | AccessTokenRejected;

/** The closed trust fields the token verifier consumes. */
export interface AccessTokenTrustConfig {
  readonly trustConfigHash: string;
  readonly issuer: string;
  readonly providerCode: string;
  readonly discoveryUrl: string;
  readonly clientId: string;
  readonly apiAudience: string;
  readonly allowedAzp: string;
  readonly oidcEndpointAllowlist: readonly string[];
  readonly accessTokenAlgorithms: readonly string[];
  readonly accessTokenMaxAgeSeconds: number;
  readonly clockSkewSeconds: number;
  readonly jwksTtlSeconds: number;
  readonly httpTimeoutSeconds: number;
}

export interface AccessTokenVerifierOptions {
  readonly trustConfig: AccessTokenTrustConfig;
  /** Trusted server clock; defaults to the process clock. */
  readonly now?: (() => Date) | undefined;
  /** Injected transport for determinant tests; defaults to the global fetch. */
  readonly fetchImpl?: AccessTokenFetchLike | undefined;
}

export interface AccessTokenVerifier {
  /**
   * Verifies one BFF-issued Human access token against the configured issuer
   * and returns the context the IdentityPolicy entry consumes, or the frozen
   * failure pair. It rejects only on an unexpected programming failure.
   */
  verify(accessToken: string, sessionBinding: Buffer): Promise<AccessTokenVerification>;
  /** Validates the two technical headers of the trusted peer. */
  verifySessionBindingHeaders(headers: WorkspaceHeaders): WorkspaceSessionBindingResult;
}

/** An actively rejected token: 401, never a fallback identity. */
class TokenRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenRejectedError';
  }
}

/** Discovery/JWKS unavailable with no usable key: 503. */
class TokenDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenDependencyError';
  }
}

interface ParsedAccessToken {
  readonly header: Record<string, unknown>;
  readonly claims: Record<string, unknown>;
  readonly kid: string;
  readonly signingInput: string;
  readonly signature: Buffer;
}

interface VerifiedClaims {
  readonly issuer: string;
  readonly subject: string;
  readonly azp: string;
  readonly issuedAtSeconds: number;
  readonly expiresAtSeconds: number;
  readonly authTimeSeconds?: number;
  readonly sidHash?: Buffer;
}

interface CachedKey {
  readonly kid: string;
  readonly key: KeyObject;
}

interface CachedMetadata {
  readonly at: number;
  readonly jwksUri: string;
}

interface SingleHeader {
  readonly present: boolean;
  readonly duplicate: boolean;
  readonly value?: string;
}

function sha256(value: string | Uint8Array): Buffer {
  return createHash('sha256').update(value).digest();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numericClaim(claims: Record<string, unknown>, key: string): number | undefined {
  const value = claims[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function audienceIncludes(claims: Record<string, unknown>, audience: string): boolean {
  const value = claims.aud;
  if (typeof value === 'string') return value === audience;
  if (Array.isArray(value)) return value.some((entry) => entry === audience);
  return false;
}

function publicKeyFromJwk(jwk: Record<string, unknown>): KeyObject | undefined {
  if (jwk.kty !== 'RSA') return undefined;
  if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string') return undefined;
  if (jwk.use !== undefined && jwk.use !== 'sig') return undefined;
  if (jwk.alg !== undefined && jwk.alg !== 'RS256') return undefined;
  try {
    return createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
  } catch {
    return undefined;
  }
}

/**
 * Parses a compact JWS under hard bounds. `none`, any algorithm outside the
 * configured allowlist, and a token that asks for another key source
 * (`jku`/`x5u`) are rejected before a single byte is fetched.
 */
function parseAccessToken(token: string, algorithms: readonly string[]): ParsedAccessToken {
  if (Buffer.byteLength(token, 'utf8') > ACCESS_TOKEN_MAX_BYTES) {
    throw new TokenRejectedError('token too large');
  }
  const segments = token.split('.');
  if (segments.length !== 3) throw new TokenRejectedError('malformed token');
  const [headerSegment, claimsSegment, signatureSegment] = segments as [string, string, string];
  if (headerSegment.length === 0 || claimsSegment.length === 0 || signatureSegment.length === 0) {
    throw new TokenRejectedError('malformed token');
  }
  let header: unknown;
  let claims: unknown;
  try {
    header = JSON.parse(Buffer.from(headerSegment, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(claimsSegment, 'base64url').toString('utf8'));
  } catch {
    throw new TokenRejectedError('malformed token');
  }
  if (!isPlainRecord(header) || !isPlainRecord(claims)) {
    throw new TokenRejectedError('malformed token');
  }
  if (header.jku !== undefined || header.x5u !== undefined) {
    throw new TokenRejectedError('alternate key source rejected');
  }
  const algorithm = header.alg;
  if (typeof algorithm !== 'string' || algorithm === 'none' || !algorithms.includes(algorithm)) {
    throw new TokenRejectedError('token algorithm rejected');
  }
  const kid = header.kid;
  if (typeof kid !== 'string' || kid.length === 0 || kid.length > 256) {
    throw new TokenRejectedError('token key id rejected');
  }
  const signature = Buffer.from(signatureSegment, 'base64url');
  if (signature.length === 0) throw new TokenRejectedError('malformed signature');
  return { header, claims, kid, signingInput: `${headerSegment}.${claimsSegment}`, signature };
}

function verifyRs256(parsed: ParsedAccessToken, key: KeyObject): boolean {
  if (parsed.header.alg !== 'RS256') return false;
  try {
    return createVerify('RSA-SHA256').update(parsed.signingInput).verify(key, parsed.signature);
  } catch {
    return false;
  }
}

/**
 * The multi-claim check of Session Delta §1: exact issuer, API audience, the
 * single allowed BFF `azp`, the Keycloak `typ=Bearer` claim and the JOSE
 * `typ=JWT` header, `exp`/`nbf`/`iat` inside the clock skew, and a lifetime no
 * longer than `accessTokenMaxAgeSeconds`. A token can never be presented as an
 * ID token, a service token or a token with a substituted subject.
 */
function validateClaims(
  parsed: ParsedAccessToken,
  config: AccessTokenTrustConfig,
  validatedAt: Date,
): VerifiedClaims {
  if (parsed.header.typ !== 'JWT') throw new TokenRejectedError('JOSE type rejected');
  const claims = parsed.claims;
  const issuer = claims.iss;
  if (typeof issuer !== 'string' || issuer.length === 0 || issuer !== config.issuer) {
    throw new TokenRejectedError('issuer rejected');
  }
  const subject = claims.sub;
  if (typeof subject !== 'string' || subject.length === 0 || subject.length > 1024) {
    throw new TokenRejectedError('subject rejected');
  }
  if (!audienceIncludes(claims, config.apiAudience)) {
    throw new TokenRejectedError('audience rejected');
  }
  const azp = claims.azp;
  if (typeof azp !== 'string' || azp.length === 0 || azp !== config.allowedAzp) {
    throw new TokenRejectedError('authorized party rejected');
  }
  if (claims.typ !== 'Bearer') throw new TokenRejectedError('token type rejected');

  const expiresAtSeconds = numericClaim(claims, 'exp');
  const issuedAtSeconds = numericClaim(claims, 'iat');
  if (expiresAtSeconds === undefined || issuedAtSeconds === undefined) {
    throw new TokenRejectedError('token lifetime missing');
  }
  if (expiresAtSeconds <= issuedAtSeconds) throw new TokenRejectedError('token lifetime invalid');
  const skew = config.clockSkewSeconds;
  const nowSeconds = Math.floor(validatedAt.getTime() / 1000);
  const notBeforeSeconds = numericClaim(claims, 'nbf');
  if (notBeforeSeconds !== undefined && nowSeconds < notBeforeSeconds - skew) {
    throw new TokenRejectedError('token not yet valid');
  }
  if (nowSeconds > expiresAtSeconds + skew) throw new TokenRejectedError('token expired');
  if (issuedAtSeconds - skew > nowSeconds) {
    throw new TokenRejectedError('token issued in the future');
  }
  if (expiresAtSeconds - issuedAtSeconds > config.accessTokenMaxAgeSeconds) {
    throw new TokenRejectedError('token lifetime too long');
  }

  const authTimeSeconds = numericClaim(claims, 'auth_time');
  const sid = claims.sid;
  return {
    issuer,
    subject,
    azp,
    issuedAtSeconds,
    expiresAtSeconds,
    ...(authTimeSeconds === undefined ? {} : { authTimeSeconds }),
    ...(typeof sid === 'string' && sid.length > 0 && sid.length <= MAX_SID_CHARS
      ? { sidHash: sha256(sid) }
      : {}),
  };
}

/**
 * Canonical issuer-configuration description: the five deployment values the
 * authentication context binds, hashed with the shared canonical JSON rule so
 * the digest is stable across processes and object key order.
 */
function issuerConfigHash(config: AccessTokenTrustConfig): string {
  return sha256CanonicalJson({
    issuer: config.issuer,
    discoveryUrl: config.discoveryUrl,
    clientId: config.clientId,
    apiAudience: config.apiAudience,
    allowedAzp: config.allowedAzp,
  });
}

async function readLimitedText(response: Response, limit: number): Promise<string> {
  const body = response.body;
  if (body === null) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > limit) {
      throw new TokenDependencyError('response too large');
    }
    return text;
  }
  const reader: ReadableStreamDefaultReader<Uint8Array> = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new TokenDependencyError('response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Case-insensitive single-value lookup; a repeated header is never merged. */
function readSingleHeader(headers: WorkspaceHeaders, name: string): SingleHeader {
  const values: string[] = [];
  let malformed = false;
  for (const [key, entry] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue;
    if (typeof entry === 'string') {
      values.push(entry);
      continue;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) {
        if (typeof item === 'string') values.push(item);
        else malformed = true;
      }
      continue;
    }
    malformed = true;
  }
  if (malformed || values.length > 1) return { present: true, duplicate: true };
  const [only] = values;
  if (only === undefined) return { present: false, duplicate: false };
  return { present: true, duplicate: false, value: only };
}

/**
 * The Core access-token verifier of exactly one configured issuer. Keys come
 * only from the discovery document's allowlisted `jwks_uri`; a known `kid` is
 * used only while the cache is inside `jwksTtlSeconds`, and an unknown `kid`
 * triggers at most one bounded refresh per 30 seconds.
 */
export function createAccessTokenVerifier(
  options: AccessTokenVerifierOptions,
): AccessTokenVerifier {
  const config = options.trustConfig;
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const nowMs = (): number => now().getTime();

  let metadataCache: CachedMetadata | undefined;
  let keyCache: { readonly at: number; readonly keys: readonly CachedKey[] } | undefined;
  let keyRefreshAt = 0;
  let keyInFlight: Promise<void> | undefined;

  /** The frozen status of a code lives in one table, never in a literal here. */
  const rejection = (code: CoreErrorCode): AccessTokenRejected => ({
    ok: false,
    code,
    status: CORE_ERROR_TABLE[code].status,
  });
  const rejected = (): AccessTokenRejected => rejection(CORE_ERROR_CODE.AUTHENTICATION_REQUIRED);

  function failureOf(error: unknown): AccessTokenRejected {
    if (error instanceof TokenDependencyError) {
      return rejection(CORE_ERROR_CODE.DEPENDENCY_UNAVAILABLE);
    }
    if (error instanceof TokenRejectedError) return rejected();
    throw error;
  }

  async function fetchJson(url: string): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(config.httpTimeoutSeconds * 1000),
      });
    } catch {
      throw new TokenDependencyError('oidc request failed');
    }
    if (!response.ok) throw new TokenDependencyError('oidc document unavailable');
    const text = await readLimitedText(response, MAX_OIDC_JSON_BYTES);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new TokenDependencyError('oidc document malformed');
    }
    if (!isPlainRecord(parsed)) throw new TokenDependencyError('oidc document malformed');
    return parsed;
  }

  async function metadata(): Promise<CachedMetadata> {
    const cached = metadataCache;
    if (cached !== undefined && nowMs() - cached.at < config.jwksTtlSeconds * 1000) return cached;
    const document = await fetchJson(config.discoveryUrl);
    if (document.issuer !== config.issuer) {
      throw new TokenDependencyError('discovery issuer mismatch');
    }
    const jwksUri = document.jwks_uri;
    if (typeof jwksUri !== 'string' || !config.oidcEndpointAllowlist.includes(jwksUri)) {
      throw new TokenDependencyError('jwks endpoint not allowlisted');
    }
    const value: CachedMetadata = { at: nowMs(), jwksUri };
    metadataCache = value;
    return value;
  }

  async function loadKeys(jwksUri: string): Promise<void> {
    const document = await fetchJson(jwksUri);
    const rawKeys = document.keys;
    if (!Array.isArray(rawKeys) || rawKeys.length === 0 || rawKeys.length > MAX_JWKS_KEYS) {
      throw new TokenDependencyError('jwks malformed');
    }
    const keys: CachedKey[] = [];
    for (const entry of rawKeys) {
      if (!isPlainRecord(entry)) continue;
      const kid = entry.kid;
      if (typeof kid !== 'string' || kid.length === 0) continue;
      const key = publicKeyFromJwk(entry);
      if (key !== undefined) keys.push({ kid, key });
    }
    if (keys.length === 0) throw new TokenDependencyError('jwks has no usable key');
    const at = nowMs();
    keyCache = { at, keys: Object.freeze(keys) };
    keyRefreshAt = at;
  }

  async function keyFor(kid: string): Promise<KeyObject> {
    const { jwksUri } = await metadata();
    const at = nowMs();
    let cache = keyCache;
    if (cache === undefined || at - cache.at >= config.jwksTtlSeconds * 1000) {
      await loadKeys(jwksUri);
      cache = keyCache;
    }
    const cached = cache?.keys.find((entry) => entry.kid === kid);
    if (cached !== undefined) return cached.key;
    if (at - keyRefreshAt < MIN_KEY_REFRESH_INTERVAL_MS) {
      throw new TokenRejectedError('unknown key id');
    }
    if (keyInFlight !== undefined) {
      await keyInFlight;
    } else {
      keyCache = undefined;
      const task = loadKeys(jwksUri);
      keyInFlight = task;
      try {
        await task;
      } finally {
        keyInFlight = undefined;
      }
    }
    const refreshed = keyCache?.keys.find((entry) => entry.kid === kid);
    if (refreshed === undefined) throw new TokenRejectedError('unknown key id');
    return refreshed.key;
  }

  function verifySessionBindingHeaders(headers: WorkspaceHeaders): WorkspaceSessionBindingResult {
    for (const name of FORBIDDEN_BROWSER_OVERRIDE_HEADERS) {
      if (readSingleHeader(headers, name).present) {
        return rejection(CORE_ERROR_CODE.API_VALUE_INVALID);
      }
    }
    const binding = readSingleHeader(headers, SESSION_BINDING_HEADER);
    if (!binding.present) return rejected();
    if (binding.duplicate) {
      return rejection(CORE_ERROR_CODE.API_VALUE_INVALID);
    }
    const encoded = binding.value ?? '';
    if (
      encoded.length < 43 ||
      encoded.length > MAX_SESSION_BINDING_HEADER_CHARS ||
      !BASE64URL_PATTERN.test(encoded)
    ) {
      return rejection(CORE_ERROR_CODE.API_VALUE_INVALID);
    }
    const sessionBinding = Buffer.from(encoded, 'base64url');
    if (
      sessionBinding.length < MIN_SESSION_BINDING_BYTES ||
      sessionBinding.length > MAX_SESSION_BINDING_BYTES ||
      sessionBinding.toString('base64url') !== encoded
    ) {
      return rejection(CORE_ERROR_CODE.API_VALUE_INVALID);
    }

    const presentedHash = readSingleHeader(headers, TRUST_CONFIG_HASH_HEADER);
    if (!presentedHash.present) return rejected();
    if (presentedHash.duplicate) {
      return rejection(CORE_ERROR_CODE.API_VALUE_INVALID);
    }
    const candidate = presentedHash.value ?? '';
    const expected = config.trustConfigHash;
    if (!SHA256_HEX_PATTERN.test(candidate) || !SHA256_HEX_PATTERN.test(expected))
      return rejected();
    if (!timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(expected, 'hex'))) {
      return rejected();
    }
    return { ok: true, sessionBinding };
  }

  async function verify(
    accessToken: string,
    sessionBinding: Buffer,
  ): Promise<AccessTokenVerification> {
    if (
      sessionBinding.length < MIN_SESSION_BINDING_BYTES ||
      sessionBinding.length > MAX_SESSION_BINDING_BYTES
    ) {
      return rejected();
    }
    try {
      const parsed = parseAccessToken(accessToken, config.accessTokenAlgorithms);
      const key = await keyFor(parsed.kid);
      if (!verifyRs256(parsed, key)) throw new TokenRejectedError('signature invalid');
      const validatedAt = now();
      const claims = validateClaims(parsed, config, validatedAt);
      return {
        ok: true,
        context: {
          trustConfigHash: config.trustConfigHash,
          issuerConfigHash: issuerConfigHash(config),
          providerCode: config.providerCode,
          issuer: claims.issuer,
          accountExternalId: claims.issuer,
          subjectExternalId: claims.subject,
          clientId: config.clientId,
          apiAudience: config.apiAudience,
          azp: claims.azp,
          tokenSha256: sha256(accessToken),
          issuedAt: new Date(claims.issuedAtSeconds * 1000),
          expiresAt: new Date(claims.expiresAtSeconds * 1000),
          validatedAt,
          sessionBindingHash: sha256(sessionBinding),
          ...(claims.authTimeSeconds === undefined
            ? {}
            : { authTime: new Date(claims.authTimeSeconds * 1000) }),
          ...(claims.sidHash === undefined ? {} : { sidHash: claims.sidHash }),
        },
      };
    } catch (error) {
      return failureOf(error);
    }
  }

  return { verify, verifySessionBindingHeaders };
}
