import { describe, expect, it } from 'vitest';
import { createBff } from './app.js';
import { peerListAllows } from './peers.js';
import { TRUST_CONFIG_ENV, loadBffTrustConfigFromEnv } from './trust-config.js';

const VALID_CONFIG: Record<string, unknown> = {
  trustConfigVersion: 'v1',
  publicOrigin: 'http://127.0.0.1:4100',
  allowedHosts: ['127.0.0.1:4100'],
  trustedProxyPeers: [],
  issuer: 'http://127.0.0.1:9999/realms/test',
  providerCode: 'keycloak',
  discoveryUrl: 'http://127.0.0.1:9999/.well-known/openid-configuration',
  clientId: 'workspace-bff',
  clientAuthSecretRef: 'env:TEST_CLIENT_SECRET',
  apiAudience: 'zhiju-api',
  allowedAzp: 'workspace-bff',
  callbackUri: 'http://127.0.0.1:4100/bff/auth/callback',
  postLogoutRedirectUri: 'http://127.0.0.1:4100/workbench',
  returnRoutePatterns: ['/workbench', '/projects/:projectRef'],
  oidcEndpointAllowlist: [
    'http://127.0.0.1:9999/.well-known/openid-configuration',
    'http://127.0.0.1:9999/token',
  ],
  apiBaseUrl: 'http://127.0.0.1:9998/api',
  apiGatewayPeers: ['127.0.0.1/32', '::1/128'],
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
  capabilityCodes: {
    workspaceProjectDiscoveryHumanV1: 'code-a',
    projectBoardSliceReadHumanV1: 'code-b',
    taskBoardReadHumanV1: 'code-c',
    taskBoardSourceReadV1: 'code-d',
    taskBoardHealthReadV1: 'code-e',
    taskBoardPolicyReadV1: 'code-f',
  },
  boardService: { principalId: '01920000-0000-7000-8000-0000000000b0' },
};

function envFor(config: unknown, secret = 'secret'): Record<string, string | undefined> {
  return {
    [TRUST_CONFIG_ENV]: typeof config === 'string' ? config : JSON.stringify(config),
    TEST_CLIENT_SECRET: secret,
  };
}

describe('trust config loader', () => {
  it('accepts only the closed document with a resolvable secret', () => {
    const loaded = loadBffTrustConfigFromEnv(envFor(VALID_CONFIG));
    expect(loaded.status).toBe('CONFIGURED');
    if (loaded.status !== 'CONFIGURED') throw new Error('unreachable');
    expect(loaded.loaded.config.issuer).toBe('http://127.0.0.1:9999/realms/test');
    expect(loaded.loaded.configHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(loaded.loaded.clientAuthSecret).toBe('secret');
  });

  it('fails closed for absent, malformed, unknown-keyed or unbound configuration', () => {
    const cases: Record<string, string | undefined>[] = [
      {},
      envFor('{'),
      envFor({ ...VALID_CONFIG, unexpectedExtra: true }, undefined),
      envFor({ ...VALID_CONFIG, idTokenAlgorithms: ['HS256'] }),
      envFor({ ...VALID_CONFIG, publicOrigin: 'http://example.com' }),
      envFor({ ...VALID_CONFIG, publicOrigin: 'http://127.0.0.1:4100/' }),
      envFor({ ...VALID_CONFIG, callbackUri: 'http://127.0.0.1:4100/other' }),
      envFor({ ...VALID_CONFIG, accessTokenMaxAgeSeconds: 301 }),
      envFor({ ...VALID_CONFIG, discoveryUrl: 'http://127.0.0.1:9999/other' }),
      envFor({ ...VALID_CONFIG, clientAuthSecretRef: 'vault:secret' }),
      envFor({ ...VALID_CONFIG, boardService: { principalId: 'x', extra: true } }),
      envFor({ ...VALID_CONFIG, capabilityCodes: { workspaceProjectDiscoveryHumanV1: 'a' } }),
      envFor({ ...VALID_CONFIG, apiGatewayPeers: ['*'] }),
      envFor({ ...VALID_CONFIG, apiGatewayPeers: ['nope'] }),
      envFor({ ...VALID_CONFIG, apiGatewayPeers: ['127.0.0.1/33'] }),
      envFor({ ...VALID_CONFIG, apiGatewayPeers: ['::1/129'] }),
      envFor({ ...VALID_CONFIG, apiGatewayPeers: ['10.0.0.0/8/8'] }),
      envFor({ ...VALID_CONFIG, apiGatewayPeers: ['256.1.1.1'] }),
      envFor({ ...VALID_CONFIG, apiGatewayPeers: [] }),
      envFor({ ...VALID_CONFIG, trustedProxyPeers: ['10.0.0.0/33'] }),
      envFor({ ...VALID_CONFIG, trustedProxyPeers: ['proxy.example'] }),
      // Rules the Core loader applies to the very same document.
      envFor({ ...VALID_CONFIG, issuer: 'http://127.0.0.1:9999' }),
      envFor({ ...VALID_CONFIG, issuer: 'http://127.0.0.1:9999/realms/test/' }),
      envFor({ ...VALID_CONFIG, apiBaseUrl: 'http://127.0.0.1:9998' }),
      envFor({ ...VALID_CONFIG, apiBaseUrl: 'http://127.0.0.1:9998/api/' }),
      envFor({ ...VALID_CONFIG, boardService: { principalId: 'board-service' } }),
      envFor({
        ...VALID_CONFIG,
        boardService: { principalId: '01920000-0000-4000-8000-0000000000b0' },
      }),
      envFor({ ...VALID_CONFIG, providerCode: ' keycloak' }),
      envFor({ ...VALID_CONFIG, clientId: 'client\u0000id' }),
      envFor({
        ...VALID_CONFIG,
        capabilityCodes: {
          workspaceProjectDiscoveryHumanV1: 'code-a',
          projectBoardSliceReadHumanV1: 'code-b',
          taskBoardReadHumanV1: 'code-c',
          taskBoardSourceReadV1: 'code-d',
        },
      }),
    ];
    for (const [index, env] of cases.entries()) {
      expect(loadBffTrustConfigFromEnv(env).status, `case ${index}`).toBe('NOT_CONFIGURED');
    }
    const missingSecret = loadBffTrustConfigFromEnv({
      [TRUST_CONFIG_ENV]: JSON.stringify(VALID_CONFIG),
    });
    expect(missingSecret.status).toBe('NOT_CONFIGURED');
    const missingKey: Record<string, unknown> = { ...VALID_CONFIG };
    delete missingKey.providerCode;
    expect(loadBffTrustConfigFromEnv(envFor(missingKey)).status).toBe('NOT_CONFIGURED');
  });

  it('accepts exact addresses and CIDR blocks, including mapped IPv6 peers', () => {
    const accepted: Record<string, unknown>[] = [
      { ...VALID_CONFIG, apiGatewayPeers: ['127.0.0.1'] },
      { ...VALID_CONFIG, apiGatewayPeers: ['::ffff:127.0.0.1'] },
      { ...VALID_CONFIG, trustedProxyPeers: ['10.0.0.0/8', '::1/128'] },
    ];
    for (const [index, config] of accepted.entries()) {
      expect(loadBffTrustConfigFromEnv(envFor(config)).status, `case ${index}`).toBe('CONFIGURED');
    }

    expect(peerListAllows(['127.0.0.1/32'], '::ffff:127.0.0.1')).toBe(true);
    expect(peerListAllows(['127.0.0.1'], '127.0.0.1')).toBe(true);
    expect(peerListAllows(['::1/128'], '::1')).toBe(true);
    expect(peerListAllows(['::1/128'], '[::1]')).toBe(true);
    expect(peerListAllows(['10.0.0.0/8'], '10.1.2.3')).toBe(true);
    expect(peerListAllows(['10.0.0.0/8'], '11.1.2.3')).toBe(false);
    expect(peerListAllows(['127.0.0.1'], '::1')).toBe(false);
    expect(peerListAllows(['127.0.0.1'], '::ffff:10.0.0.9')).toBe(false);
    expect(peerListAllows([], '127.0.0.1')).toBe(false);
    expect(peerListAllows(['127.0.0.1'], '')).toBe(false);
    expect(peerListAllows(['127.0.0.1'], 'not-an-address')).toBe(false);
    expect(peerListAllows(['not-an-entry'], '127.0.0.1')).toBe(false);
  });
});

describe('unconfigured shell', () => {
  it('preserves the anonymous shell contract with no trust config', async () => {
    const app = await createBff({ env: {} });
    try {
      const instance = app.getHttpAdapter().getInstance();
      expect(instance.version).toBe('5.12.0');

      const health = await instance.inject({ method: 'GET', url: '/bff/health' });
      expect(health.statusCode).toBe(200);

      const bootstrap = await instance.inject({ method: 'GET', url: '/bff/bootstrap' });
      expect(bootstrap.headers['cache-control']).toBe('no-store');
      expect(JSON.parse(bootstrap.body)).toEqual({
        accessState: 'REAUTH_REQUIRED',
        businessActionsEnabled: false,
      });

      for (const path of [
        '/bff/fixture/execute',
        '/bff/upload',
        '/bff/accept-report',
        '/bff/business',
        '/bff/health',
      ]) {
        const response = await instance.inject({
          method: 'POST',
          url: path,
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify({ actorKind: 'HUMAN', fixture: true }),
        });
        expect(response.statusCode, path).toBe(503);
        const body = JSON.parse(response.body) as Record<string, unknown>;
        expect(body.code).toBe('UI_SERVICE_NOT_CONFIGURED');
        expect(JSON.stringify(body)).not.toContain('HUMAN');
      }

      for (const path of [
        '/bff/unknown',
        '/bff/queries/project.find_workspace_projects/1.0',
        '/api/workspace/session-bootstrap',
        '/api/queries/project.find_workspace_projects/1.0',
      ]) {
        const response = await instance.inject({ method: 'GET', url: path });
        expect(response.statusCode, path).toBeGreaterThanOrEqual(400);
      }
    } finally {
      await app.close();
    }
  });

  it('stays degraded for an invalid trust config instead of crashing', async () => {
    const app = await createBff({ env: { [TRUST_CONFIG_ENV]: '{"trustConfigVersion":"v1"}' } });
    try {
      const instance = app.getHttpAdapter().getInstance();
      const health = await instance.inject({ method: 'GET', url: '/bff/health' });
      expect(health.statusCode).toBe(200);
      const business = await instance.inject({ method: 'POST', url: '/bff/business' });
      expect(business.statusCode).toBe(503);
      expect((JSON.parse(business.body) as Record<string, unknown>).code).toBe(
        'UI_SERVICE_NOT_CONFIGURED',
      );
    } finally {
      await app.close();
    }
  });
});
