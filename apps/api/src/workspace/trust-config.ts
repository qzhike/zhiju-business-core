// IM-UI-01 (#258): the deployment-injected, startup-validated closed trust
// configuration of the Core workspace entry. Session Delta §1 requires the
// BFF and Core to validate the *same* document (`trustConfigVersion` plus the
// SHA-256 of the raw bytes), so this loader accepts exactly the closed schema
// of the shared deployment document and derives nothing from a Host header, a
// query parameter or a development default.
//
// The document is the only authority for which issuer, audience, azp, OIDC
// endpoint and upstream peer are trusted. A missing, malformed, unknown-keyed
// or unbound value fails closed with a safe code: Core starts without the
// workspace entry rather than with an invented identity.

import { createHash } from 'node:crypto';

import { parsePeerSpec } from './net.js';

export const CORE_TRUST_CONFIG_ENV = 'ZHIJU_WORKSPACE_TRUST_CONFIG';

/** Absent or blank configuration: the workspace entry is not configured at all. */
export const CORE_TRUST_CONFIG_NOT_CONFIGURED = 'WORKSPACE_TRUST_CONFIG_NOT_CONFIGURED';
/** Present but malformed, unknown-keyed or unbound: the document is rejected. */
export const CORE_TRUST_CONFIG_INVALID = 'WORKSPACE_TRUST_CONFIG_INVALID';

/** The fixed board-service identity the Workspace board slice reads as. */
export interface CoreBoardServiceConfig {
  readonly principalId: string;
}

export interface WorkspaceCoreTrustConfig {
  readonly trustConfigVersion: string;
  readonly publicOrigin: string;
  readonly allowedHosts: readonly string[];
  readonly trustedProxyPeers: readonly string[];
  readonly issuer: string;
  readonly providerCode: string;
  readonly discoveryUrl: string;
  readonly clientId: string;
  readonly clientAuthSecretRef: string;
  readonly apiAudience: string;
  readonly allowedAzp: string;
  readonly callbackUri: string;
  readonly postLogoutRedirectUri: string;
  readonly returnRoutePatterns: readonly string[];
  readonly oidcEndpointAllowlist: readonly string[];
  readonly apiBaseUrl: string;
  readonly apiGatewayPeers: readonly string[];
  readonly idTokenAlgorithms: readonly string[];
  readonly accessTokenAlgorithms: readonly string[];
  readonly accessTokenMaxAgeSeconds: number;
  readonly clockSkewSeconds: number;
  readonly jwksTtlSeconds: number;
  readonly httpTimeoutSeconds: number;
  readonly maxSessions: number;
  readonly maxLoginTransactions: number;
  readonly maxTransactionsPerBrowser: number;
  readonly maxConcurrentUploads: number;
  readonly capabilityCodes: CoreCapabilityCodes;
  readonly boardService: CoreBoardServiceConfig;
  /**
   * SHA-256 hex of the raw environment bytes. It is derived here, never
   * configured, and is the value Core compares against the BFF's
   * `x-workspace-trust-config-hash` header.
   */
  readonly trustConfigHash: string;
}

export type CoreTrustConfigResult =
  | { readonly ok: true; readonly config: WorkspaceCoreTrustConfig; readonly configHash: string }
  | { readonly ok: false; readonly code: string };

/**
 * Capability config keys the first version requires the deployment to map.
 * Core resolves every authorization capability through these keys, so a
 * document that omits one cannot serve the directory or the boards.
 */
export const CORE_REQUIRED_CAPABILITY_KEYS: readonly string[] = Object.freeze([
  'workspaceProjectDiscoveryHumanV1',
  'projectBoardSliceReadHumanV1',
  'taskBoardReadHumanV1',
  'taskBoardSourceReadV1',
  'taskBoardHealthReadV1',
  'taskBoardPolicyReadV1',
]);

/** The six capability keys this entry resolves, declared for its consumers. */
export interface CoreRequiredCapabilityCodes {
  readonly workspaceProjectDiscoveryHumanV1: string;
  readonly projectBoardSliceReadHumanV1: string;
  readonly taskBoardReadHumanV1: string;
  readonly taskBoardSourceReadV1: string;
  readonly taskBoardHealthReadV1: string;
  readonly taskBoardPolicyReadV1: string;
}

/**
 * The deployment's capability map. Extra keys are accepted so the very same
 * document also serves the BFF, while the six keys Core resolves are declared:
 * an owning authorization port can take this map without a cast.
 */
export type CoreCapabilityCodes = Readonly<Record<string, string>> & CoreRequiredCapabilityCodes;

/** The closed key set of the single accepted configuration document. */
const CONFIG_KEYS: readonly string[] = Object.freeze([
  'trustConfigVersion',
  'publicOrigin',
  'allowedHosts',
  'trustedProxyPeers',
  'issuer',
  'providerCode',
  'discoveryUrl',
  'clientId',
  'clientAuthSecretRef',
  'apiAudience',
  'allowedAzp',
  'callbackUri',
  'postLogoutRedirectUri',
  'returnRoutePatterns',
  'oidcEndpointAllowlist',
  'apiBaseUrl',
  'apiGatewayPeers',
  'idTokenAlgorithms',
  'accessTokenAlgorithms',
  'accessTokenMaxAgeSeconds',
  'clockSkewSeconds',
  'jwksTtlSeconds',
  'httpTimeoutSeconds',
  'maxSessions',
  'maxLoginTransactions',
  'maxTransactionsPerBrowser',
  'maxConcurrentUploads',
  'capabilityCodes',
  'boardService',
]);

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SECRET_REF_PATTERN = /^env:[A-Za-z_][A-Za-z0-9_]*$/u;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** No control characters and no surrounding whitespace: the value is compared verbatim. */
function isBoundString(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/**
 * A fixed HTTPS URL without credentials, query or fragment. Loopback HTTP is
 * accepted so the same determinant local stack can be exercised without
 * weakening a public origin — the same rule the BFF applies to this document.
 */
function parseFixedUrl(value: unknown, allowPath: boolean): URL | undefined {
  if (!isBoundString(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const loopback =
    url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return undefined;
  if (url.username.length > 0 || url.password.length > 0) return undefined;
  if (url.search.length > 0 || url.hash.length > 0) return undefined;
  if (!allowPath && url.pathname !== '/') return undefined;
  return url;
}

function requiredInteger(
  record: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number | undefined {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  return value >= min && value <= max ? value : undefined;
}

function requiredStringArray(
  record: Record<string, unknown>,
  key: string,
  options: { readonly allowEmpty: boolean; readonly item?: (value: string) => boolean },
): readonly string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  if (!options.allowEmpty && value.length === 0) return undefined;
  const result: string[] = [];
  for (const item of value) {
    if (!isBoundString(item)) return undefined;
    if (options.item !== undefined && !options.item(item)) return undefined;
    result.push(item);
  }
  return Object.freeze(result);
}

function parseReturnRoutePatterns(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const patterns: string[] = [];
  for (const entry of value) {
    if (!isBoundString(entry)) return undefined;
    if (!entry.startsWith('/') || entry.startsWith('//')) return undefined;
    if (entry.includes('\\') || entry.includes('//') || entry.includes('..')) return undefined;
    patterns.push(entry);
  }
  return Object.freeze(patterns);
}

function parseCapabilityCodes(value: unknown): CoreCapabilityCodes | undefined {
  if (!isPlainObject(value)) return undefined;
  const codes: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isBoundString(entry)) return undefined;
    codes[key] = entry;
  }
  for (const required of CORE_REQUIRED_CAPABILITY_KEYS) {
    if (codes[required] === undefined) return undefined;
  }
  return Object.freeze(codes) as CoreCapabilityCodes;
}

function parseBoardService(value: unknown): CoreBoardServiceConfig | undefined {
  if (!isPlainObject(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'principalId') return undefined;
  const principalId = value.principalId;
  if (typeof principalId !== 'string' || !UUID_V7_PATTERN.test(principalId)) return undefined;
  return Object.freeze({ principalId });
}

/**
 * The whole closed schema. Every binding is checked here; there is no partial
 * acceptance, no default value and no coercion of a wrong type.
 */
function parseTrustConfig(document: Record<string, unknown>): WorkspaceCoreTrustConfig | undefined {
  for (const key of Object.keys(document)) {
    if (!CONFIG_KEYS.includes(key)) return undefined;
  }

  const trustConfigVersion = document.trustConfigVersion;
  const publicOrigin = document.publicOrigin;
  const issuer = document.issuer;
  const providerCode = document.providerCode;
  const discoveryUrl = document.discoveryUrl;
  const clientId = document.clientId;
  const clientAuthSecretRef = document.clientAuthSecretRef;
  const apiAudience = document.apiAudience;
  const allowedAzp = document.allowedAzp;
  const callbackUri = document.callbackUri;
  const postLogoutRedirectUri = document.postLogoutRedirectUri;
  const apiBaseUrl = document.apiBaseUrl;
  if (
    !isBoundString(trustConfigVersion) ||
    !isBoundString(publicOrigin) ||
    !isBoundString(issuer) ||
    !isBoundString(providerCode) ||
    !isBoundString(clientId) ||
    !isBoundString(clientAuthSecretRef) ||
    !isBoundString(apiAudience) ||
    !isBoundString(allowedAzp) ||
    !isBoundString(callbackUri) ||
    !isBoundString(postLogoutRedirectUri) ||
    !isBoundString(apiBaseUrl) ||
    typeof discoveryUrl !== 'string'
  ) {
    return undefined;
  }

  const originUrl = parseFixedUrl(publicOrigin, false);
  if (originUrl?.origin !== publicOrigin) return undefined;
  if (issuer.endsWith('/')) return undefined;
  const issuerUrl = parseFixedUrl(issuer, true);
  if (issuerUrl === undefined) return undefined;
  if (`${issuerUrl.origin}${issuerUrl.pathname}` !== issuer) return undefined;
  if (parseFixedUrl(discoveryUrl, true) === undefined) return undefined;
  const apiUrl = parseFixedUrl(apiBaseUrl, true);
  if (apiUrl === undefined) return undefined;
  if (apiUrl.pathname === '/' || apiBaseUrl.endsWith('/')) return undefined;

  const allowedHosts = requiredStringArray(document, 'allowedHosts', {
    allowEmpty: false,
    item: (value) => !value.includes('*') && !value.includes('/') && !value.includes('\\'),
  });
  if (allowedHosts === undefined) return undefined;

  const trustedProxyPeers = requiredStringArray(document, 'trustedProxyPeers', {
    allowEmpty: true,
    item: (value) => parsePeerSpec(value) !== undefined,
  });
  if (trustedProxyPeers === undefined) return undefined;

  const oidcEndpointAllowlist = requiredStringArray(document, 'oidcEndpointAllowlist', {
    allowEmpty: false,
    item: (value) => parseFixedUrl(value, true) !== undefined,
  });
  if (oidcEndpointAllowlist === undefined) return undefined;
  if (!oidcEndpointAllowlist.includes(discoveryUrl)) return undefined;

  const returnRoutePatterns = parseReturnRoutePatterns(document.returnRoutePatterns);
  if (returnRoutePatterns === undefined) return undefined;

  const apiGatewayPeers = requiredStringArray(document, 'apiGatewayPeers', {
    allowEmpty: false,
    item: (value) => parsePeerSpec(value) !== undefined,
  });
  if (apiGatewayPeers === undefined) return undefined;

  const idTokenAlgorithms = requiredStringArray(document, 'idTokenAlgorithms', {
    allowEmpty: false,
  });
  const accessTokenAlgorithms = requiredStringArray(document, 'accessTokenAlgorithms', {
    allowEmpty: false,
  });
  if (idTokenAlgorithms === undefined || accessTokenAlgorithms === undefined) return undefined;
  if (idTokenAlgorithms.length !== 1 || idTokenAlgorithms[0] !== 'RS256') return undefined;
  if (accessTokenAlgorithms.length !== 1 || accessTokenAlgorithms[0] !== 'RS256') return undefined;

  const accessTokenMaxAgeSeconds = requiredInteger(document, 'accessTokenMaxAgeSeconds', 1, 300);
  const clockSkewSeconds = requiredInteger(document, 'clockSkewSeconds', 0, 300);
  const jwksTtlSeconds = requiredInteger(document, 'jwksTtlSeconds', 1, 3600);
  const httpTimeoutSeconds = requiredInteger(document, 'httpTimeoutSeconds', 1, 60);
  const maxSessions = requiredInteger(document, 'maxSessions', 1, 100_000);
  const maxLoginTransactions = requiredInteger(document, 'maxLoginTransactions', 1, 100_000);
  const maxTransactionsPerBrowser = requiredInteger(document, 'maxTransactionsPerBrowser', 1, 100);
  const maxConcurrentUploads = requiredInteger(document, 'maxConcurrentUploads', 1, 100);
  if (
    accessTokenMaxAgeSeconds === undefined ||
    clockSkewSeconds === undefined ||
    jwksTtlSeconds === undefined ||
    httpTimeoutSeconds === undefined ||
    maxSessions === undefined ||
    maxLoginTransactions === undefined ||
    maxTransactionsPerBrowser === undefined ||
    maxConcurrentUploads === undefined
  ) {
    return undefined;
  }

  const capabilityCodes = parseCapabilityCodes(document.capabilityCodes);
  if (capabilityCodes === undefined) return undefined;
  const boardService = parseBoardService(document.boardService);
  if (boardService === undefined) return undefined;

  if (!SECRET_REF_PATTERN.test(clientAuthSecretRef)) return undefined;
  if (callbackUri !== `${publicOrigin}/bff/auth/callback`) return undefined;
  if (postLogoutRedirectUri !== `${publicOrigin}/workbench`) return undefined;

  return Object.freeze({
    trustConfigVersion,
    publicOrigin,
    allowedHosts,
    trustedProxyPeers,
    issuer,
    providerCode,
    discoveryUrl,
    clientId,
    clientAuthSecretRef,
    apiAudience,
    allowedAzp,
    callbackUri,
    postLogoutRedirectUri,
    returnRoutePatterns,
    oidcEndpointAllowlist,
    apiBaseUrl,
    apiGatewayPeers,
    idTokenAlgorithms,
    accessTokenAlgorithms,
    accessTokenMaxAgeSeconds,
    clockSkewSeconds,
    jwksTtlSeconds,
    httpTimeoutSeconds,
    maxSessions,
    maxLoginTransactions,
    maxTransactionsPerBrowser,
    maxConcurrentUploads,
    capabilityCodes,
    boardService,
    trustConfigHash: '',
  });
}

/**
 * Fail-closed loader of the Core trust document. `configHash` is the SHA-256
 * hex of the raw environment bytes, so any byte-level difference between the
 * BFF and Core copies — including key order and whitespace — is visible as a
 * hash mismatch instead of a silent divergence.
 */
export function loadCoreTrustConfigFromEnv(env: NodeJS.ProcessEnv): CoreTrustConfigResult {
  const raw = env[CORE_TRUST_CONFIG_ENV];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, code: CORE_TRUST_CONFIG_NOT_CONFIGURED };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: CORE_TRUST_CONFIG_INVALID };
  }
  if (!isPlainObject(parsed)) return { ok: false, code: CORE_TRUST_CONFIG_INVALID };

  const config = parseTrustConfig(parsed);
  if (config === undefined) return { ok: false, code: CORE_TRUST_CONFIG_INVALID };

  const configHash = createHash('sha256').update(raw, 'utf8').digest('hex');
  const loaded = Object.freeze({ ...config, trustConfigHash: configHash });
  return { ok: true, config: loaded, configHash };
}
