import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { resolve, isAbsolute } from 'node:path';

import type { AccessTokenTrustConfig } from '../workspace/access-token.js';

/**
 * Closed MVP Core configuration. A missing or invalid value is a startup
 * rejection; the process never listens with a partially invented identity,
 * database, store or trust binding.
 */
export const MVP_TRUST_CONFIG_ENV = 'ZHIJU_MVP_TRUST_CONFIG';

export interface MvpTrustConfig extends AccessTokenTrustConfig {
  readonly publicOrigin: string;
  readonly allowedHosts: readonly string[];
  readonly trustedProxyPeers: readonly string[];
  readonly apiGatewayPeers: readonly string[];
  readonly maxConcurrentUploads: number;
  readonly accessTokenMaxAgeSeconds: number;
  readonly clockSkewSeconds: number;
}

export interface MvpCoreConfig {
  readonly instanceId: string;
  readonly databaseUrl: string;
  readonly storeRoot: string;
  readonly storeId: string;
  readonly storeIdentity: string;
  readonly cursorKey: Buffer;
  readonly trust: MvpTrustConfig;
  readonly host: string;
  readonly port: number;
  readonly incarnation: string;
}

export class MvpStartupError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`mvp core startup rejected: ${code}`);
    this.name = 'MvpStartupError';
    this.code = code;
  }
}

const TRUST_KEYS = [
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
] as const;

function object(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new MvpStartupError(code);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new MvpStartupError(code);
  return value;
}

function strings(value: unknown, code: string, allowEmpty = false): string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((item) => typeof item !== 'string')
  )
    throw new MvpStartupError(code);
  return value as string[];
}

function positiveInteger(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new MvpStartupError(code);
  return value;
}

function nonNegativeInteger(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new MvpStartupError(code);
  return value;
}

function loopbackOrHttps(value: unknown, code: string): string {
  const raw = stringValue(value, code);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MvpStartupError(code);
  }
  const loopback =
    url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    throw new MvpStartupError(code);
  return raw;
}

/** Parse the shared trust document and derive the exact bytes hash. */
export function parseMvpTrustDocument(raw: string): MvpTrustConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MvpStartupError('MVP_TRUST_CONFIG_INVALID');
  }
  const value = object(parsed, 'MVP_TRUST_CONFIG_INVALID');
  if (Object.keys(value).sort().join(',') !== [...TRUST_KEYS].sort().join(','))
    throw new MvpStartupError('MVP_TRUST_CONFIG_INVALID');
  const algorithms = strings(value.accessTokenAlgorithms, 'MVP_TRUST_CONFIG_INVALID');
  if (algorithms.some((item) => item !== 'RS256'))
    throw new MvpStartupError('MVP_TRUST_CONFIG_INVALID');
  const discoveryUrl = loopbackOrHttps(value.discoveryUrl, 'MVP_TRUST_CONFIG_INVALID');
  const oidcEndpointAllowlist = strings(
    value.oidcEndpointAllowlist,
    'MVP_TRUST_CONFIG_INVALID',
  ).map((item) => loopbackOrHttps(item, 'MVP_TRUST_CONFIG_INVALID'));
  const trustConfigHash = createHash('sha256').update(raw, 'utf8').digest('hex');
  return {
    trustConfigHash,
    publicOrigin: loopbackOrHttps(value.publicOrigin, 'MVP_TRUST_CONFIG_INVALID'),
    allowedHosts: strings(value.allowedHosts, 'MVP_TRUST_CONFIG_INVALID'),
    trustedProxyPeers: strings(value.trustedProxyPeers, 'MVP_TRUST_CONFIG_INVALID', true),
    issuer: stringValue(value.issuer, 'MVP_TRUST_CONFIG_INVALID'),
    providerCode: stringValue(value.providerCode, 'MVP_TRUST_CONFIG_INVALID'),
    discoveryUrl,
    clientId: stringValue(value.clientId, 'MVP_TRUST_CONFIG_INVALID'),
    apiAudience: stringValue(value.apiAudience, 'MVP_TRUST_CONFIG_INVALID'),
    allowedAzp: stringValue(value.allowedAzp, 'MVP_TRUST_CONFIG_INVALID'),
    oidcEndpointAllowlist,
    accessTokenAlgorithms: algorithms,
    accessTokenMaxAgeSeconds: positiveInteger(
      value.accessTokenMaxAgeSeconds,
      'MVP_TRUST_CONFIG_INVALID',
    ),
    clockSkewSeconds: nonNegativeInteger(value.clockSkewSeconds, 'MVP_TRUST_CONFIG_INVALID'),
    jwksTtlSeconds: positiveInteger(value.jwksTtlSeconds, 'MVP_TRUST_CONFIG_INVALID'),
    httpTimeoutSeconds: positiveInteger(value.httpTimeoutSeconds, 'MVP_TRUST_CONFIG_INVALID'),
    apiGatewayPeers: strings(value.apiGatewayPeers, 'MVP_TRUST_CONFIG_INVALID'),
    maxConcurrentUploads: positiveInteger(value.maxConcurrentUploads, 'MVP_TRUST_CONFIG_INVALID'),
  };
}

function required(env: NodeJS.ProcessEnv, name: string, code: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0) throw new MvpStartupError(code);
  return value;
}

function key(value: string, code: string): Buffer {
  const hex =
    /^[0-9a-fA-F]+$/u.test(value) && value.length % 2 === 0 ? Buffer.from(value, 'hex') : undefined;
  const decoded = hex ?? Buffer.from(value, 'base64');
  if (decoded.length < 32) throw new MvpStartupError(code);
  return decoded;
}

export function loadMvpCoreConfig(env: NodeJS.ProcessEnv = process.env): MvpCoreConfig {
  const instanceId = required(env, 'ZHIJU_MVP_INSTANCE_ID', 'MVP_INSTANCE_ID_MISSING');
  if (!/^[0-9a-f]{16}$/u.test(instanceId)) throw new MvpStartupError('MVP_INSTANCE_ID_INVALID');
  const storeId = required(env, 'ZHIJU_MVP_STORE_ID', 'MVP_STORE_ID_MISSING');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(storeId))
    throw new MvpStartupError('MVP_STORE_ID_INVALID');
  const storeIdentity = required(env, 'ZHIJU_MVP_STORE_IDENTITY', 'MVP_STORE_IDENTITY_MISSING');
  if (!/^[0-9a-f]{64}$/u.test(storeIdentity))
    throw new MvpStartupError('MVP_STORE_IDENTITY_INVALID');
  const storeRoot = required(env, 'ZHIJU_MVP_STORE_ROOT', 'MVP_STORE_ROOT_MISSING');
  if (!isAbsolute(storeRoot) || storeRoot.includes('\0'))
    throw new MvpStartupError('MVP_STORE_ROOT_INVALID');
  const port = Number(required(env, 'ZHIJU_MVP_CORE_PORT', 'MVP_CORE_PORT_MISSING'));
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
    throw new MvpStartupError('MVP_CORE_PORT_INVALID');
  const rawTrust = required(env, MVP_TRUST_CONFIG_ENV, 'MVP_TRUST_CONFIG_MISSING');
  return {
    instanceId,
    databaseUrl: required(env, 'ZHIJU_MVP_DATABASE_URL', 'MVP_DATABASE_URL_MISSING'),
    storeRoot: resolve(storeRoot),
    storeId,
    storeIdentity,
    cursorKey: key(
      required(env, 'ZHIJU_MVP_CURSOR_KEY', 'MVP_CURSOR_KEY_MISSING'),
      'MVP_CURSOR_KEY_INVALID',
    ),
    trust: parseMvpTrustDocument(rawTrust),
    host: env.ZHIJU_MVP_CORE_HOST ?? '127.0.0.1',
    port,
    incarnation: `${hostname()}:${process.pid}:${Date.now()}`,
  };
}
