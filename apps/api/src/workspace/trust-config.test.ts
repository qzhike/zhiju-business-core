import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { normalizeRemoteAddress, parsePeerSpec, peerAllowed } from './net.js';
import {
  CORE_TRUST_CONFIG_ENV,
  CORE_TRUST_CONFIG_INVALID,
  CORE_TRUST_CONFIG_NOT_CONFIGURED,
  CORE_REQUIRED_CAPABILITY_KEYS,
  loadCoreTrustConfigFromEnv,
  type CoreTrustConfigResult,
} from './trust-config.js';

/** A UuidV7 board-service Principal. */
const BOARD_SERVICE_PRINCIPAL = '01890a5d-ac96-774b-bcce-b302099a8057';

function validDocument(): Record<string, unknown> {
  const capabilityCodes: Record<string, string> = {};
  for (const key of CORE_REQUIRED_CAPABILITY_KEYS) capabilityCodes[key] = `identity.cap.${key}`;
  return {
    trustConfigVersion: 'zhiju-workspace-2026-10-09',
    publicOrigin: 'https://workspace.example',
    allowedHosts: ['workspace.example'],
    trustedProxyPeers: [],
    issuer: 'https://idp.example/realms/zhiju',
    providerCode: 'keycloak',
    discoveryUrl: 'https://idp.example/realms/zhiju/.well-known/openid-configuration',
    clientId: 'zhiju-workspace-bff',
    clientAuthSecretRef: 'env:ZHIJU_BFF_CLIENT_SECRET',
    apiAudience: 'zhiju-core-api',
    allowedAzp: 'zhiju-workspace-bff',
    callbackUri: 'https://workspace.example/bff/auth/callback',
    postLogoutRedirectUri: 'https://workspace.example/workbench',
    returnRoutePatterns: ['/workbench'],
    oidcEndpointAllowlist: [
      'https://idp.example/realms/zhiju/.well-known/openid-configuration',
      'https://idp.example/realms/zhiju/protocol/openid-connect/certs',
    ],
    apiBaseUrl: 'https://core.example/api',
    apiGatewayPeers: ['10.0.0.0/8', '127.0.0.1'],
    idTokenAlgorithms: ['RS256'],
    accessTokenAlgorithms: ['RS256'],
    accessTokenMaxAgeSeconds: 300,
    clockSkewSeconds: 30,
    jwksTtlSeconds: 300,
    httpTimeoutSeconds: 10,
    maxSessions: 1000,
    maxLoginTransactions: 2000,
    maxTransactionsPerBrowser: 4,
    maxConcurrentUploads: 4,
    capabilityCodes,
    boardService: { principalId: BOARD_SERVICE_PRINCIPAL },
  };
}

function load(document: unknown): CoreTrustConfigResult {
  return loadCoreTrustConfigFromEnv({
    [CORE_TRUST_CONFIG_ENV]: typeof document === 'string' ? document : JSON.stringify(document),
  });
}

function loadedConfig(document: Record<string, unknown>) {
  const result = load(document);
  if (!result.ok) throw new Error(`expected a valid document, got ${result.code}`);
  return result;
}

describe('core trust configuration loader', () => {
  it('accepts the closed deployment document and derives the raw-byte hash', () => {
    const document = validDocument();
    const raw = JSON.stringify(document);
    const result = loadedConfig(document);

    expect(result.configHash).toBe(createHash('sha256').update(raw, 'utf8').digest('hex'));
    expect(result.config.trustConfigHash).toBe(result.configHash);
    expect(result.config.issuer).toBe('https://idp.example/realms/zhiju');
    expect(result.config.apiBaseUrl).toBe('https://core.example/api');
    expect(result.config.apiGatewayPeers).toEqual(['10.0.0.0/8', '127.0.0.1']);
    expect(result.config.accessTokenMaxAgeSeconds).toBe(300);
    expect(result.config.capabilityCodes.taskBoardPolicyReadV1).toBe(
      'identity.cap.taskBoardPolicyReadV1',
    );
    expect(Object.isFrozen(result.config)).toBe(true);
    expect(Object.isFrozen(result.config.apiGatewayPeers)).toBe(true);
  });

  it('hashes the raw bytes, so a byte difference changes the hash', () => {
    const compact = loadedConfig(validDocument());
    const spaced = loadedConfig(validDocument());
    expect(compact.configHash).toHaveLength(64);
    const reordered = loadCoreTrustConfigFromEnv({
      [CORE_TRUST_CONFIG_ENV]: JSON.stringify(validDocument(), null, 2),
    });
    if (!reordered.ok) throw new Error('expected a valid document');
    expect(reordered.configHash).not.toBe(compact.configHash);
    expect(spaced.configHash).toBe(compact.configHash);
  });

  it('reports NOT_CONFIGURED when the environment carries no document', () => {
    expect(loadCoreTrustConfigFromEnv({})).toEqual({
      ok: false,
      code: CORE_TRUST_CONFIG_NOT_CONFIGURED,
    });
    expect(loadCoreTrustConfigFromEnv({ [CORE_TRUST_CONFIG_ENV]: '   ' })).toEqual({
      ok: false,
      code: CORE_TRUST_CONFIG_NOT_CONFIGURED,
    });
  });

  it('accepts loopback HTTP OIDC endpoints for the local stack', () => {
    const document = {
      ...validDocument(),
      issuer: 'http://127.0.0.1:8080/realms/zhiju',
      discoveryUrl: 'http://127.0.0.1:8080/realms/zhiju/.well-known/openid-configuration',
      oidcEndpointAllowlist: [
        'http://127.0.0.1:8080/realms/zhiju/.well-known/openid-configuration',
        'http://127.0.0.1:8080/realms/zhiju/protocol/openid-connect/certs',
      ],
    };
    expect(load(document).ok).toBe(true);
  });

  const violations: readonly (readonly [string, (document: Record<string, unknown>) => void])[] = [
    ['malformed JSON', (document) => void (document.trustConfigVersion = 1)],
    ['an unknown top-level key', (document) => void (document.extraKey = 'x')],
    [
      'a trailing slash on the issuer',
      (document) => void (document.issuer = 'https://idp.example/realms/zhiju/'),
    ],
    [
      'a trailing slash on publicOrigin',
      (document) => void (document.publicOrigin = 'https://workspace.example/'),
    ],
    [
      'an apiBaseUrl without a path prefix',
      (document) => void (document.apiBaseUrl = 'https://core.example'),
    ],
    [
      'a trailing slash on apiBaseUrl',
      (document) => void (document.apiBaseUrl = 'https://core.example/api/'),
    ],
    [
      'a non-HTTPS public origin',
      (document) => void (document.publicOrigin = 'http://workspace.example'),
    ],
    [
      'a discovery URL missing from the allowlist',
      (document) =>
        void (document.discoveryUrl =
          'https://idp.example/realms/other/.well-known/openid-configuration'),
    ],
    [
      'a mismatched callback URI',
      (document) => void (document.callbackUri = 'https://workspace.example/callback'),
    ],
    [
      'a mismatched post-logout URI',
      (document) => void (document.postLogoutRedirectUri = 'https://workspace.example/'),
    ],
    ['an empty allowed host list', (document) => void (document.allowedHosts = [])],
    ['a wildcard allowed host', (document) => void (document.allowedHosts = ['*.example'])],
    ['an empty gateway peer list', (document) => void (document.apiGatewayPeers = [])],
    ['an unparsable gateway peer', (document) => void (document.apiGatewayPeers = ['not-an-ip'])],
    [
      'an out-of-range CIDR prefix',
      (document) => void (document.apiGatewayPeers = ['10.0.0.0/33']),
    ],
    [
      'a malformed trusted proxy peer',
      (document) => void (document.trustedProxyPeers = ['10.0.0.0//8']),
    ],
    ['a non-RS256 ID token algorithm', (document) => void (document.idTokenAlgorithms = ['RS384'])],
    [
      'an empty access token algorithm list',
      (document) => void (document.accessTokenAlgorithms = []),
    ],
    [
      'an access token lifetime above 300 seconds',
      (document) => void (document.accessTokenMaxAgeSeconds = 301),
    ],
    ['a zero access token lifetime', (document) => void (document.accessTokenMaxAgeSeconds = 0)],
    [
      'a fractional access token lifetime',
      (document) => void (document.accessTokenMaxAgeSeconds = 300.5),
    ],
    ['a negative clock skew', (document) => void (document.clockSkewSeconds = -1)],
    ['a zero JWKS TTL', (document) => void (document.jwksTtlSeconds = 0)],
    ['a zero HTTP timeout', (document) => void (document.httpTimeoutSeconds = 0)],
    ['a zero session capacity', (document) => void (document.maxSessions = 0)],
    ['a zero upload capacity', (document) => void (document.maxConcurrentUploads = 0)],
    [
      'a capability code with an empty value',
      (document) => {
        const codes = document.capabilityCodes as Record<string, string>;
        codes.taskBoardReadHumanV1 = '';
      },
    ],
    [
      'a non-string capability code',
      (document) => {
        const codes = document.capabilityCodes as Record<string, unknown>;
        codes.taskBoardReadHumanV1 = 7;
      },
    ],
    [
      'a board service with an extra key',
      (document) => {
        document.boardService = { principalId: BOARD_SERVICE_PRINCIPAL, extra: 'x' };
      },
    ],
    [
      'a UuidV4 board service principal',
      (document) => {
        document.boardService = { principalId: '01890a5d-ac96-474b-bcce-b302099a8057' };
      },
    ],
    [
      'a non-UUID board service principal',
      (document) => {
        document.boardService = { principalId: 'board-service' };
      },
    ],
    [
      'a secret ref outside the env: form',
      (document) => void (document.clientAuthSecretRef = 'vault:secret'),
    ],
    ['an unpadded-string issuer with whitespace', (document) => void (document.clientId = ' bff ')],
    [
      'an OIDC allowlist missing the discovery document',
      (document) =>
        void (document.oidcEndpointAllowlist = [
          'https://idp.example/realms/zhiju/protocol/openid-connect/certs',
        ]),
    ],
    ['an empty return route list', (document) => void (document.returnRoutePatterns = [])],
    [
      'an absolute return route',
      (document) => void (document.returnRoutePatterns = ['//evil.example']),
    ],
    ['a missing audit field', (document) => void delete document.trustConfigVersion],
  ];

  for (const [name, mutate] of violations) {
    it(`rejects ${name}`, () => {
      const document = validDocument();
      mutate(document);
      expect(load(document)).toEqual({ ok: false, code: CORE_TRUST_CONFIG_INVALID });
    });
  }

  it('rejects a document that is not a JSON object', () => {
    expect(load('[]')).toEqual({ ok: false, code: CORE_TRUST_CONFIG_INVALID });
    expect(load('null')).toEqual({ ok: false, code: CORE_TRUST_CONFIG_INVALID });
    expect(load('{"broken":')).toEqual({ ok: false, code: CORE_TRUST_CONFIG_INVALID });
  });

  it('exposes the six capability codes an owning port consumes without a cast', () => {
    const config = loadedConfig(validDocument()).config;
    const discovery: Record<
      'workspaceProjectDiscoveryHumanV1' | 'projectBoardSliceReadHumanV1',
      string
    > = config.capabilityCodes;
    expect(discovery.workspaceProjectDiscoveryHumanV1).toBe(
      'identity.cap.workspaceProjectDiscoveryHumanV1',
    );
    expect(config.capabilityCodes.taskBoardPolicyReadV1).toBe('identity.cap.taskBoardPolicyReadV1');
    const extended = validDocument();
    (extended.capabilityCodes as Record<string, string>).extraCapabilityV1 = 'identity.cap.extra';
    expect(load(extended).ok).toBe(true);
  });

  it('rejects a document that omits any required capability key', () => {
    for (const key of CORE_REQUIRED_CAPABILITY_KEYS) {
      const document = validDocument();
      const codes = document.capabilityCodes as Record<string, string>;
      document.capabilityCodes = Object.fromEntries(
        Object.entries(codes).filter(([code]) => code !== key),
      );
      expect(load(document)).toEqual({ ok: false, code: CORE_TRUST_CONFIG_INVALID });
    }
  });
});

describe('core peer allowlist', () => {
  const allowed = (peers: readonly string[], remote: string): boolean =>
    peerAllowed({ apiGatewayPeers: peers }, remote);

  it('matches an exact IPv4 address', () => {
    expect(allowed(['10.1.2.3'], '10.1.2.3')).toBe(true);
    expect(allowed(['10.1.2.3'], '10.1.2.4')).toBe(false);
    expect(allowed(['10.1.2.3'], '10.1.2.30')).toBe(false);
  });

  it('matches an IPv4 CIDR block', () => {
    expect(allowed(['10.0.0.0/8'], '10.255.255.255')).toBe(true);
    expect(allowed(['10.0.0.0/8'], '10.0.0.1')).toBe(true);
    expect(allowed(['10.0.0.0/8'], '11.0.0.1')).toBe(false);
    expect(allowed(['192.168.1.128/25'], '192.168.1.255')).toBe(true);
    expect(allowed(['192.168.1.128/25'], '192.168.1.127')).toBe(false);
  });

  it('normalizes IPv4-mapped IPv6 addresses in both directions', () => {
    expect(allowed(['127.0.0.1'], '::ffff:127.0.0.1')).toBe(true);
    expect(allowed(['::ffff:10.0.0.1'], '10.0.0.1')).toBe(true);
    expect(allowed(['10.0.0.0/8'], '::ffff:10.9.9.9')).toBe(true);
    expect(allowed(['127.0.0.1'], '::ffff:127.0.0.2')).toBe(false);
  });

  it('matches IPv6 addresses and blocks', () => {
    expect(allowed(['2001:db8::1'], '2001:db8::1')).toBe(true);
    expect(allowed(['2001:db8::1'], '2001:db8::2')).toBe(false);
    expect(allowed(['2001:db8::/32'], '2001:db8:1234::9')).toBe(true);
    expect(allowed(['2001:db8::/32'], '2001:db9::1')).toBe(false);
    expect(allowed(['::1'], '::1')).toBe(true);
    expect(allowed(['[::1]'], '::1')).toBe(true);
    expect(allowed(['fe80::1'], 'fe80::1%eth0')).toBe(true);
  });

  it('rejects unmatched, malformed and cross-family peers', () => {
    expect(allowed(['10.0.0.0/8'], '192.168.1.1')).toBe(false);
    expect(allowed([], '10.0.0.1')).toBe(false);
    expect(allowed(['10.0.0.0/8'], 'not-an-ip')).toBe(false);
    expect(allowed(['10.0.0.0/8'], '')).toBe(false);
    expect(allowed(['127.0.0.1'], '::1')).toBe(false);
    expect(allowed(['::1'], '127.0.0.1')).toBe(false);
    expect(allowed(['nonsense'], '10.0.0.1')).toBe(false);
  });

  it('normalizes socket address spellings before comparing', () => {
    expect(normalizeRemoteAddress('::FFFF:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeRemoteAddress('[::1]')).toBe('::1');
    expect(normalizeRemoteAddress('fe80::1%en0')).toBe('fe80::1');
    expect(normalizeRemoteAddress(' 10.0.0.1 ')).toBe('10.0.0.1');
    expect(normalizeRemoteAddress('not-an-ip')).toBe('not-an-ip');
  });

  it('parses a closed peer specification', () => {
    expect(parsePeerSpec('10.0.0.0/8')).toEqual({ family: 4, value: 0x0a000000n, prefix: 8 });
    expect(parsePeerSpec('10.1.2.3')).toEqual({ family: 4, value: 0x0a010203n, prefix: 32 });
    expect(parsePeerSpec('2001:db8::1')?.prefix).toBe(128);
    expect(parsePeerSpec('2001:db8::/32')?.prefix).toBe(32);
    expect(parsePeerSpec('2001:db8::/129')).toBeUndefined();
    expect(parsePeerSpec('10.0.0.0/8/8')).toBeUndefined();
    expect(parsePeerSpec('10.0.0.256')).toBeUndefined();
    expect(parsePeerSpec('')).toBeUndefined();
    expect(parsePeerSpec('10.0.0.0/x')).toBeUndefined();
  });
});
