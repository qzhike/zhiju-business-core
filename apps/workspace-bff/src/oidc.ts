import type { KeyObject } from 'node:crypto';
import { publicKeyFromJwk } from './jwt.js';
import type { BffTrustConfig } from './trust-config.js';

export type FetchLike = typeof fetch;

const MAX_OIDC_JSON_BYTES = 64 * 1024;
const MAX_JWKS_KEYS = 64;
const MIN_KEY_REFRESH_INTERVAL_MS = 30_000;

/** A dependency (network, OIDC, Keycloak, JWKS) failed: fail closed with 503. */
export class OidcDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidcDependencyError';
  }
}

/** A token or exchange result was actively rejected: 401, no fallback identity. */
export class OidcRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidcRejectedError';
  }
}

export interface OidcMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  endSessionEndpoint: string | undefined;
  revocationEndpoint: string | undefined;
}

export interface TokenSet {
  idToken: string | undefined;
  accessToken: string;
  refreshToken: string | undefined;
}

interface CachedKey {
  kid: string;
  key: KeyObject;
}

async function readLimitedText(response: Response, limit: number): Promise<string> {
  const body = response.body;
  if (body === null) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > limit) {
      throw new OidcDependencyError('response too large');
    }
    return text;
  }
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new OidcDependencyError('response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function audienceIncludes(claims: Record<string, unknown>, audience: string): boolean {
  const value = claims.aud;
  if (typeof value === 'string') return value === audience;
  if (Array.isArray(value)) return value.some((entry) => entry === audience);
  return false;
}

export function numericClaim(claims: Record<string, unknown>, key: string): number | undefined {
  const value = claims[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Discovery + JWKS + token endpoint client for exactly one configured issuer.
 * Every endpoint is taken from discovery but must also appear verbatim in the
 * deployment allowlist, so a tampered discovery document cannot redirect us.
 */
export class OidcProvider {
  private metadataCache: { at: number; value: OidcMetadata } | undefined;
  private keyCache: { at: number; keys: CachedKey[] } | undefined;
  private keyRefreshAt = 0;
  private keyInFlight: Promise<void> | undefined;

  constructor(
    private readonly config: BffTrustConfig,
    private readonly options: {
      fetchImpl: FetchLike;
      clientSecret: string;
      now: () => number;
    },
  ) {}

  async metadata(): Promise<OidcMetadata> {
    const cached = this.metadataCache;
    if (cached && this.options.now() - cached.at < this.config.jwksTtlSeconds * 1000) {
      return cached.value;
    }
    const document = await this.fetchJson(this.config.discoveryUrl);
    if (document.issuer !== this.config.issuer) {
      throw new OidcDependencyError('discovery issuer mismatch');
    }
    if (document.authorization_response_iss_parameter_supported !== true) {
      throw new OidcDependencyError('iss parameter not supported');
    }
    const value: OidcMetadata = {
      issuer: this.config.issuer,
      authorizationEndpoint: this.allowedEndpoint(document.authorization_endpoint),
      tokenEndpoint: this.allowedEndpoint(document.token_endpoint),
      jwksUri: this.allowedEndpoint(document.jwks_uri),
      endSessionEndpoint: this.optionalEndpoint(document.end_session_endpoint),
      revocationEndpoint: this.optionalEndpoint(document.revocation_endpoint),
    };
    this.metadataCache = { at: this.options.now(), value };
    return value;
  }

  private allowedEndpoint(value: unknown): string {
    if (typeof value !== 'string' || !this.config.oidcEndpointAllowlist.includes(value)) {
      throw new OidcDependencyError('endpoint not allowlisted');
    }
    return value;
  }

  private optionalEndpoint(value: unknown): string | undefined {
    return value === undefined ? undefined : this.allowedEndpoint(value);
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.options.fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.config.httpTimeoutSeconds * 1000),
      });
    } catch {
      throw new OidcDependencyError('oidc request failed');
    }
    if (!response.ok) throw new OidcDependencyError('oidc document unavailable');
    const text = await readLimitedText(response, MAX_OIDC_JSON_BYTES);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new OidcDependencyError('oidc document malformed');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new OidcDependencyError('oidc document malformed');
    }
    return parsed as Record<string, unknown>;
  }

  private async loadKeys(jwksUri: string): Promise<void> {
    const document = await this.fetchJson(jwksUri);
    const rawKeys = document.keys;
    if (!Array.isArray(rawKeys) || rawKeys.length === 0 || rawKeys.length > MAX_JWKS_KEYS) {
      throw new OidcDependencyError('jwks malformed');
    }
    const keys: CachedKey[] = [];
    for (const entry of rawKeys) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      const kid = record.kid;
      if (typeof kid !== 'string' || kid.length === 0) continue;
      const key = publicKeyFromJwk(record);
      if (key) keys.push({ kid, key });
    }
    if (keys.length === 0) throw new OidcDependencyError('jwks has no usable key');
    const now = this.options.now();
    this.keyCache = { at: now, keys };
    this.keyRefreshAt = now;
  }

  /**
   * Resolves the signing key for a kid. An unknown kid triggers at most one
   * bounded refresh per 30s; a refresh failure with no usable key is 503.
   */
  async keyFor(kid: string): Promise<KeyObject> {
    const metadata = await this.metadata();
    const now = this.options.now();
    let cache = this.keyCache;
    if (!cache || now - cache.at >= this.config.jwksTtlSeconds * 1000) {
      await this.loadKeys(metadata.jwksUri);
      cache = this.keyCache;
    }
    const cached = cache?.keys.find((entry) => entry.kid === kid);
    if (cached) return cached.key;
    if (now - this.keyRefreshAt < MIN_KEY_REFRESH_INTERVAL_MS) {
      throw new OidcRejectedError('unknown key id');
    }
    if (this.keyInFlight) {
      await this.keyInFlight;
    } else {
      this.keyCache = undefined;
      const task = this.loadKeys(metadata.jwksUri);
      this.keyInFlight = task;
      try {
        await task;
      } finally {
        this.keyInFlight = undefined;
      }
    }
    const refreshed = this.keyCache?.keys.find((entry) => entry.kid === kid);
    if (!refreshed) throw new OidcRejectedError('unknown key id');
    return refreshed.key;
  }

  private async requestTokens(
    form: URLSearchParams,
    options: { requireIdToken: boolean },
  ): Promise<TokenSet> {
    const metadata = await this.metadata();
    let response: Response;
    try {
      response = await this.options.fetchImpl(metadata.tokenEndpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
        signal: AbortSignal.timeout(this.config.httpTimeoutSeconds * 1000),
      });
    } catch {
      throw new OidcDependencyError('token request failed');
    }
    if (response.status >= 500) throw new OidcDependencyError('token endpoint unavailable');
    const text = await readLimitedText(response, MAX_OIDC_JSON_BYTES);
    if (!response.ok) throw new OidcRejectedError('token request rejected');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new OidcDependencyError('token response malformed');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new OidcDependencyError('token response malformed');
    }
    const record = parsed as Record<string, unknown>;
    const idToken = record.id_token;
    const accessToken = record.access_token;
    if (options.requireIdToken && (typeof idToken !== 'string' || idToken.length === 0)) {
      throw new OidcDependencyError('token response missing id_token');
    }
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new OidcDependencyError('token response missing access_token');
    }
    const tokenType = record.token_type;
    if (tokenType !== undefined && tokenType !== 'Bearer') {
      throw new OidcRejectedError('unexpected token type');
    }
    const refreshToken = record.refresh_token;
    return {
      idToken: typeof idToken === 'string' && idToken.length > 0 ? idToken : undefined,
      accessToken,
      refreshToken:
        typeof refreshToken === 'string' && refreshToken.length > 0 ? refreshToken : undefined,
    };
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<TokenSet & { idToken: string }> {
    const tokens = await this.requestTokens(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: this.config.callbackUri,
        client_id: this.config.clientId,
        client_secret: this.options.clientSecret,
        code_verifier: input.codeVerifier,
      }),
      { requireIdToken: true },
    );
    if (tokens.idToken === undefined)
      throw new OidcDependencyError('token response missing id_token');
    return { ...tokens, idToken: tokens.idToken };
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    return this.requestTokens(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.config.clientId,
        client_secret: this.options.clientSecret,
      }),
      { requireIdToken: false },
    );
  }
}
