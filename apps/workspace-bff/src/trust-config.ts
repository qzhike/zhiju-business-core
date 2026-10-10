import { parsePeerSpec } from './peers.js';
import { hasControlCharacters, isPlainObject, isUuidV7, sha256Hex } from './support.js';

export const TRUST_CONFIG_ENV = 'ZHIJU_WORKSPACE_TRUST_CONFIG';

export interface BffBoardServiceConfig {
  principalId: string;
}

/**
 * Deployment-injected, startup-validated closed document. Nothing here may be
 * derived from a Host header, a query parameter or a development default.
 */
export interface BffTrustConfig {
  trustConfigVersion: string;
  publicOrigin: string;
  allowedHosts: string[];
  trustedProxyPeers: string[];
  issuer: string;
  providerCode: string;
  discoveryUrl: string;
  clientId: string;
  clientAuthSecretRef: string;
  apiAudience: string;
  allowedAzp: string;
  callbackUri: string;
  postLogoutRedirectUri: string;
  returnRoutePatterns: string[];
  oidcEndpointAllowlist: string[];
  apiBaseUrl: string;
  apiGatewayPeers: string[];
  idTokenAlgorithms: string[];
  accessTokenAlgorithms: string[];
  accessTokenMaxAgeSeconds: number;
  clockSkewSeconds: number;
  jwksTtlSeconds: number;
  httpTimeoutSeconds: number;
  maxSessions: number;
  maxLoginTransactions: number;
  maxTransactionsPerBrowser: number;
  maxConcurrentUploads: number;
  capabilityCodes: Record<string, string>;
  boardService: BffBoardServiceConfig;
}

export interface LoadedBffTrustConfig {
  config: BffTrustConfig;
  configHash: string;
  clientAuthSecret: string;
}

export type BffTrustConfigResult =
  { status: 'NOT_CONFIGURED' } | { status: 'CONFIGURED'; loaded: LoadedBffTrustConfig };

/**
 * Capability config keys the first version requires the deployment to map. The
 * Core entry resolves the same document and requires the same six keys, so a
 * single document cannot be accepted by one side and rejected by the other.
 */
const REQUIRED_CAPABILITY_KEYS = [
  'workspaceProjectDiscoveryHumanV1',
  'projectBoardSliceReadHumanV1',
  'taskBoardReadHumanV1',
  'taskBoardSourceReadV1',
  'taskBoardHealthReadV1',
  'taskBoardPolicyReadV1',
] as const;

/** Closed key set of the single accepted configuration document. */
const CONFIG_KEYS: Record<string, true> = {
  trustConfigVersion: true,
  publicOrigin: true,
  allowedHosts: true,
  trustedProxyPeers: true,
  issuer: true,
  providerCode: true,
  discoveryUrl: true,
  clientId: true,
  clientAuthSecretRef: true,
  apiAudience: true,
  allowedAzp: true,
  callbackUri: true,
  postLogoutRedirectUri: true,
  returnRoutePatterns: true,
  oidcEndpointAllowlist: true,
  apiBaseUrl: true,
  apiGatewayPeers: true,
  idTokenAlgorithms: true,
  accessTokenAlgorithms: true,
  accessTokenMaxAgeSeconds: true,
  clockSkewSeconds: true,
  jwksTtlSeconds: true,
  httpTimeoutSeconds: true,
  maxSessions: true,
  maxLoginTransactions: true,
  maxTransactionsPerBrowser: true,
  maxConcurrentUploads: true,
  capabilityCodes: true,
  boardService: true,
};

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

/**
 * Only a fixed HTTPS origin is accepted; loopback HTTP is allowed so the same
 * determinant local stack can be exercised without weakening public origins.
 */
function parseFixedUrl(value: unknown, options: { allowPath: boolean }): URL | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const schemeOk =
    url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname));
  if (!schemeOk) return undefined;
  if (url.username.length > 0 || url.password.length > 0) return undefined;
  if (url.search.length > 0 || url.hash.length > 0) return undefined;
  if (!options.allowPath && url.pathname !== '/') return undefined;
  return url;
}

/** No control characters and no surrounding whitespace: compared verbatim. */
function isBoundString(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return false;
  return !hasControlCharacters(value);
}

function requiredString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return isBoundString(value) ? value : undefined;
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
  options: { allowEmpty: boolean; item?: (value: string) => boolean },
): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  if (!options.allowEmpty && value.length === 0) return undefined;
  const result: string[] = [];
  for (const item of value) {
    if (!isBoundString(item)) return undefined;
    if (options.item && !options.item(item)) return undefined;
    result.push(item);
  }
  return result;
}

function parseReturnRoutePatterns(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const patterns: string[] = [];
  for (const entry of value) {
    if (!isBoundString(entry)) return undefined;
    if (!entry.startsWith('/') || entry.startsWith('//')) return undefined;
    if (entry.includes('\\') || entry.includes('//') || entry.includes('..')) return undefined;
    patterns.push(entry);
  }
  return patterns;
}

function parseCapabilityCodes(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined;
  const codes: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isBoundString(entry)) return undefined;
    codes[key] = entry;
  }
  for (const required of REQUIRED_CAPABILITY_KEYS) {
    const entry = codes[required];
    if (entry === undefined || entry.length === 0) return undefined;
  }
  return codes;
}

function parseBoardService(value: unknown): BffBoardServiceConfig | undefined {
  if (!isPlainObject(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'principalId') return undefined;
  const principalId = value.principalId;
  return typeof principalId === 'string' && isUuidV7(principalId) ? { principalId } : undefined;
}

function parseTrustConfig(document: Record<string, unknown>): BffTrustConfig | undefined {
  for (const key of Object.keys(document)) {
    if (!Object.hasOwn(CONFIG_KEYS, key)) return undefined;
  }

  const trustConfigVersion = requiredString(document, 'trustConfigVersion');
  const publicOrigin = requiredString(document, 'publicOrigin');
  const issuer = requiredString(document, 'issuer');
  const providerCode = requiredString(document, 'providerCode');
  const discoveryUrl = requiredString(document, 'discoveryUrl');
  const clientId = requiredString(document, 'clientId');
  const clientAuthSecretRef = requiredString(document, 'clientAuthSecretRef');
  const apiAudience = requiredString(document, 'apiAudience');
  const allowedAzp = requiredString(document, 'allowedAzp');
  const callbackUri = requiredString(document, 'callbackUri');
  const postLogoutRedirectUri = requiredString(document, 'postLogoutRedirectUri');
  const apiBaseUrl = requiredString(document, 'apiBaseUrl');
  if (
    trustConfigVersion === undefined ||
    publicOrigin === undefined ||
    issuer === undefined ||
    providerCode === undefined ||
    discoveryUrl === undefined ||
    clientId === undefined ||
    clientAuthSecretRef === undefined ||
    apiAudience === undefined ||
    allowedAzp === undefined ||
    callbackUri === undefined ||
    postLogoutRedirectUri === undefined ||
    apiBaseUrl === undefined
  ) {
    return undefined;
  }

  const originUrl = parseFixedUrl(publicOrigin, { allowPath: false });
  if (originUrl?.origin !== publicOrigin) return undefined;
  if (issuer.endsWith('/')) return undefined;
  const issuerUrl = parseFixedUrl(issuer, { allowPath: true });
  if (issuerUrl === undefined) return undefined;
  if (`${issuerUrl.origin}${issuerUrl.pathname}` !== issuer) return undefined;
  if (parseFixedUrl(discoveryUrl, { allowPath: true }) === undefined) return undefined;
  const apiUrl = parseFixedUrl(apiBaseUrl, { allowPath: true });
  if (apiUrl === undefined) return undefined;
  if (apiUrl.pathname === '/' || apiBaseUrl.endsWith('/')) return undefined;

  const allowedHosts = requiredStringArray(document, 'allowedHosts', {
    allowEmpty: false,
    item: (value) => !value.includes('*') && !value.includes('/') && !value.includes('\\'),
  });
  if (!allowedHosts) return undefined;
  if (allowedHosts.length === 0) return undefined;

  const trustedProxyPeers = requiredStringArray(document, 'trustedProxyPeers', {
    allowEmpty: true,
    item: (value) => parsePeerSpec(value) !== undefined,
  });
  if (!trustedProxyPeers) return undefined;

  const oidcEndpointAllowlist = requiredStringArray(document, 'oidcEndpointAllowlist', {
    allowEmpty: false,
    item: (value) => parseFixedUrl(value, { allowPath: true }) !== undefined,
  });
  if (!oidcEndpointAllowlist) return undefined;
  if (!oidcEndpointAllowlist.includes(discoveryUrl)) return undefined;

  const returnRoutePatterns = parseReturnRoutePatterns(document.returnRoutePatterns);
  if (!returnRoutePatterns) return undefined;

  const apiGatewayPeers = requiredStringArray(document, 'apiGatewayPeers', {
    allowEmpty: false,
    item: (value) => parsePeerSpec(value) !== undefined,
  });
  if (!apiGatewayPeers) return undefined;

  const idTokenAlgorithms = requiredStringArray(document, 'idTokenAlgorithms', {
    allowEmpty: false,
  });
  const accessTokenAlgorithms = requiredStringArray(document, 'accessTokenAlgorithms', {
    allowEmpty: false,
  });
  if (!idTokenAlgorithms || !accessTokenAlgorithms) return undefined;
  if (idTokenAlgorithms.length !== 1 || idTokenAlgorithms[0] !== 'RS256') return undefined;
  if (accessTokenAlgorithms.length !== 1 || accessTokenAlgorithms[0] !== 'RS256') return undefined;

  const accessTokenMaxAgeSeconds = requiredInteger(document, 'accessTokenMaxAgeSeconds', 1, 300);
  const clockSkewSeconds = requiredInteger(document, 'clockSkewSeconds', 0, 300);
  const jwksTtlSeconds = requiredInteger(document, 'jwksTtlSeconds', 1, 3600);
  const httpTimeoutSeconds = requiredInteger(document, 'httpTimeoutSeconds', 1, 60);
  const maxSessions = requiredInteger(document, 'maxSessions', 1, 100000);
  const maxLoginTransactions = requiredInteger(document, 'maxLoginTransactions', 1, 100000);
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
  if (!capabilityCodes) return undefined;
  const boardService = parseBoardService(document.boardService);
  if (!boardService) return undefined;

  if (!/^env:[A-Za-z_][A-Za-z0-9_]*$/u.test(clientAuthSecretRef)) return undefined;
  if (callbackUri !== `${publicOrigin}/bff/auth/callback`) return undefined;
  if (postLogoutRedirectUri !== `${publicOrigin}/workbench`) return undefined;

  return {
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
  };
}

/**
 * Fail-closed loader: absent, malformed, unknown-keyed or unbound configuration
 * always degrades to NOT_CONFIGURED instead of throwing or inventing defaults.
 */
export function loadBffTrustConfigFromEnv(
  env: Record<string, string | undefined>,
): BffTrustConfigResult {
  const raw = env[TRUST_CONFIG_ENV];
  if (typeof raw !== 'string' || raw.trim().length === 0) return { status: 'NOT_CONFIGURED' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'NOT_CONFIGURED' };
  }
  if (!isPlainObject(parsed)) return { status: 'NOT_CONFIGURED' };

  const config = parseTrustConfig(parsed);
  if (!config) return { status: 'NOT_CONFIGURED' };

  const secretName = config.clientAuthSecretRef.slice('env:'.length);
  const clientAuthSecret = env[secretName];
  if (typeof clientAuthSecret !== 'string' || clientAuthSecret.length === 0) {
    return { status: 'NOT_CONFIGURED' };
  }

  return {
    status: 'CONFIGURED',
    loaded: { config, configHash: sha256Hex(raw), clientAuthSecret },
  };
}
