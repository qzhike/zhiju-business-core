import { createHash, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import type { VerifiedOidcContextInput } from '@zhiju/identity-policy';
import { sha256CanonicalJson } from '@zhiju/shared-kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  SESSION_BINDING_HEADER,
  TRUST_CONFIG_HASH_HEADER,
  createAccessTokenVerifier,
  type AccessTokenVerification,
  type WorkspaceHeaders,
} from './access-token.js';
import {
  CORE_TRUST_CONFIG_ENV,
  loadCoreTrustConfigFromEnv,
  type WorkspaceCoreTrustConfig,
} from './trust-config.js';

const API_AUDIENCE = 'zhiju-core-api';
const AZP = 'zhiju-workspace-bff';
const CLIENT_ID = 'zhiju-workspace-bff';
const KID = 'test-key-1';
const DISCOVERY_PATH = '/realms/zhiju/.well-known/openid-configuration';
const CERTS_PATH = '/realms/zhiju/protocol/openid-connect/certs';
const FIXED_NOW = Date.UTC(2026, 9, 10, 12, 0, 0);
const SESSION_BINDING = Buffer.alloc(32, 7);

const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const signingKey: KeyObject = keyPair.privateKey;
const jwk = keyPair.publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string };

let server: Server;
let origin = '';
let issuer = '';
let discoveryUrl = '';
let certsUrl = '';
let fetchedPaths: string[] = [];
let certsFetches = 0;
let discoveryDocument: Record<string, unknown> = {};
let certsStatus = 200;
let certsBody = '';
let nowMs = FIXED_NOW;

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function baseClaims(): Record<string, unknown> {
  const seconds = Math.floor(nowMs / 1000);
  return {
    iss: issuer,
    sub: 'user-1',
    aud: [API_AUDIENCE, 'account'],
    azp: AZP,
    typ: 'Bearer',
    iat: seconds,
    exp: seconds + 300,
    auth_time: seconds - 60,
    sid: 'sid-1',
  };
}

interface MintOptions {
  readonly header?: Record<string, unknown>;
  readonly claims?: Record<string, unknown>;
  /** `null` produces a token with a placeholder signature (`alg: none`). */
  readonly privateKey?: KeyObject | null;
}

function mintToken(options: MintOptions = {}): string {
  const header = { alg: 'RS256', typ: 'JWT', kid: KID, ...(options.header ?? {}) };
  const claims = { ...baseClaims(), ...(options.claims ?? {}) };
  const signingInput = `${encodeSegment(header)}.${encodeSegment(claims)}`;
  const key = options.privateKey === undefined ? signingKey : options.privateKey;
  const signature =
    key === null
      ? 'AAAA'
      : createSign('RSA-SHA256').update(signingInput).sign(key).toString('base64url');
  return `${signingInput}.${signature}`;
}

function testTrustConfig(options: { allowCerts?: boolean } = {}): WorkspaceCoreTrustConfig {
  const allowCerts = options.allowCerts ?? true;
  const document = {
    trustConfigVersion: 'test-v1',
    publicOrigin: 'https://workspace.example',
    allowedHosts: ['workspace.example'],
    trustedProxyPeers: [],
    issuer,
    providerCode: 'keycloak',
    discoveryUrl,
    clientId: CLIENT_ID,
    clientAuthSecretRef: 'env:ZHIJU_BFF_CLIENT_SECRET',
    apiAudience: API_AUDIENCE,
    allowedAzp: AZP,
    callbackUri: 'https://workspace.example/bff/auth/callback',
    postLogoutRedirectUri: 'https://workspace.example/workbench',
    returnRoutePatterns: ['/workbench'],
    oidcEndpointAllowlist: allowCerts ? [discoveryUrl, certsUrl] : [discoveryUrl],
    apiBaseUrl: 'https://core.example/api',
    apiGatewayPeers: ['10.0.0.0/8'],
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
      workspaceProjectDiscoveryHumanV1: 'identity.cap.discovery',
      projectBoardSliceReadHumanV1: 'identity.cap.projectBoard',
      taskBoardReadHumanV1: 'identity.cap.taskBoard',
      taskBoardSourceReadV1: 'identity.cap.taskBoardSource',
      taskBoardHealthReadV1: 'identity.cap.taskBoardHealth',
      taskBoardPolicyReadV1: 'identity.cap.taskBoardPolicy',
    },
    boardService: { principalId: '01890a5d-ac96-774b-bcce-b302099a8057' },
  };
  const result = loadCoreTrustConfigFromEnv({
    [CORE_TRUST_CONFIG_ENV]: JSON.stringify(document),
  });
  if (!result.ok) throw new Error(`the test trust document is invalid: ${result.code}`);
  return result.config;
}

function verifierFor(config: WorkspaceCoreTrustConfig) {
  return createAccessTokenVerifier({
    trustConfig: config,
    now: () => new Date(nowMs),
    fetchImpl: globalThis.fetch,
  });
}

function expectRejected(result: AccessTokenVerification, status: number, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.status).toBe(status);
  expect(result.code).toBe(code);
}

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? '';
    fetchedPaths.push(path);
    if (path === DISCOVERY_PATH) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(discoveryDocument));
      return;
    }
    if (path === CERTS_PATH) {
      certsFetches += 1;
      response.writeHead(certsStatus, { 'content-type': 'application/json' });
      response.end(certsBody);
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{}');
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  origin = `http://127.0.0.1:${address.port}`;
  issuer = `${origin}/realms/zhiju`;
  discoveryUrl = `${origin}${DISCOVERY_PATH}`;
  certsUrl = `${origin}${CERTS_PATH}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
});

beforeEach(() => {
  fetchedPaths = [];
  certsFetches = 0;
  nowMs = FIXED_NOW;
  discoveryDocument = {
    issuer,
    jwks_uri: certsUrl,
    authorization_response_iss_parameter_supported: true,
  };
  certsStatus = 200;
  certsBody = JSON.stringify({ keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }] });
});

describe('core access token verifier', () => {
  it('accepts a correctly signed token and builds the frozen context', async () => {
    const config = testTrustConfig();
    const verifier = verifierFor(config);
    const token = mintToken();

    const result = await verifier.verify(token, SESSION_BINDING);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The context is directly assignable to the IdentityPolicy entry input.
    const identityInput: VerifiedOidcContextInput = result.context;
    expect(identityInput.subjectExternalId).toBe('user-1');
    expect(result.context.trustConfigHash).toBe(config.trustConfigHash);
    expect(result.context.issuerConfigHash).toBe(
      sha256CanonicalJson({
        issuer: config.issuer,
        discoveryUrl: config.discoveryUrl,
        clientId: config.clientId,
        apiAudience: config.apiAudience,
        allowedAzp: config.allowedAzp,
      }),
    );
    expect(result.context.providerCode).toBe('keycloak');
    expect(result.context.issuer).toBe(issuer);
    expect(result.context.accountExternalId).toBe(issuer);
    expect(result.context.clientId).toBe(CLIENT_ID);
    expect(result.context.apiAudience).toBe(API_AUDIENCE);
    expect(result.context.azp).toBe(AZP);
    expect(result.context.tokenSha256.toString('hex')).toBe(
      createHash('sha256').update(token, 'utf8').digest('hex'),
    );
    expect(result.context.sessionBindingHash.toString('hex')).toBe(
      createHash('sha256').update(SESSION_BINDING).digest('hex'),
    );
    expect(result.context.issuedAt.getTime()).toBe(Math.floor(FIXED_NOW / 1000) * 1000);
    expect(result.context.expiresAt.getTime()).toBe((Math.floor(FIXED_NOW / 1000) + 300) * 1000);
    expect(result.context.validatedAt.getTime()).toBe(FIXED_NOW);
    expect(result.context.authTime?.getTime()).toBe((Math.floor(FIXED_NOW / 1000) - 60) * 1000);
    expect(result.context.sidHash).toHaveLength(32);
    expect(fetchedPaths).toEqual([DISCOVERY_PATH, CERTS_PATH]);
  });

  it('reuses the cached key set inside the JWKS TTL', async () => {
    const verifier = verifierFor(testTrustConfig());
    await verifier.verify(mintToken(), SESSION_BINDING);
    nowMs += 60_000;
    const second = await verifier.verify(mintToken(), SESSION_BINDING);

    expect(second.ok).toBe(true);
    expect(certsFetches).toBe(1);
  });

  const claimRejections: readonly (readonly [string, MintOptions])[] = [
    ['a foreign issuer', { claims: { iss: 'https://other.example/realms/zhiju' } }],
    ['an empty issuer claim', { claims: { iss: '' } }],
    ['a foreign audience', { claims: { aud: ['other-api'] } }],
    ['a missing audience', { claims: { aud: undefined } }],
    ['a foreign authorized party', { claims: { azp: 'other-client' } }],
    ['a missing authorized party', { claims: { azp: undefined } }],
    ['an ID token type claim', { claims: { typ: 'ID' } }],
    ['a missing type claim', { claims: { typ: undefined } }],
    ['a non-Bearer token type', { claims: { typ: 'DPoP' } }],
    ['an empty subject', { claims: { sub: '' } }],
    ['a missing subject', { claims: { sub: undefined } }],
    ['a missing expiration', { claims: { exp: undefined } }],
    ['a missing issued-at', { claims: { iat: undefined } }],
    [
      'an inverted lifetime',
      { claims: { iat: Math.floor(FIXED_NOW / 1000), exp: Math.floor(FIXED_NOW / 1000) } },
    ],
  ];

  for (const [name, options] of claimRejections) {
    it(`rejects ${name}`, async () => {
      const result = await verifierFor(testTrustConfig()).verify(
        mintToken(options),
        SESSION_BINDING,
      );
      expectRejected(result, 401, 'AUTHENTICATION_REQUIRED');
    });
  }

  it('rejects a token signed by another key', async () => {
    const result = await verifierFor(testTrustConfig()).verify(
      mintToken({ privateKey: otherKeyPair.privateKey }),
      SESSION_BINDING,
    );
    expectRejected(result, 401, 'AUTHENTICATION_REQUIRED');
  });

  it('rejects an expired token and a future token outside the skew', async () => {
    const seconds = Math.floor(FIXED_NOW / 1000);
    const expired = await verifierFor(testTrustConfig()).verify(
      mintToken({ claims: { iat: seconds - 400, exp: seconds - 100 } }),
      SESSION_BINDING,
    );
    expectRejected(expired, 401, 'AUTHENTICATION_REQUIRED');

    const future = await verifierFor(testTrustConfig()).verify(
      mintToken({ claims: { iat: seconds + 600, exp: seconds + 900 } }),
      SESSION_BINDING,
    );
    expectRejected(future, 401, 'AUTHENTICATION_REQUIRED');

    const notYetValid = await verifierFor(testTrustConfig()).verify(
      mintToken({ claims: { nbf: seconds + 600 } }),
      SESSION_BINDING,
    );
    expectRejected(notYetValid, 401, 'AUTHENTICATION_REQUIRED');
  });

  it('accepts clock skew inside the configured tolerance', async () => {
    const seconds = Math.floor(FIXED_NOW / 1000);
    const result = await verifierFor(testTrustConfig()).verify(
      mintToken({ claims: { iat: seconds + 20, exp: seconds + 320, nbf: seconds - 20 } }),
      SESSION_BINDING,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a token lifetime longer than the configured maximum', async () => {
    const seconds = Math.floor(FIXED_NOW / 1000);
    const result = await verifierFor(testTrustConfig()).verify(
      mintToken({ claims: { iat: seconds - 10, exp: seconds + 291 } }),
      SESSION_BINDING,
    );
    expectRejected(result, 401, 'AUTHENTICATION_REQUIRED');
  });

  const headerRejections: readonly (readonly [string, MintOptions])[] = [
    ['alg none', { header: { alg: 'none' }, privateKey: null }],
    ['alg HS256', { header: { alg: 'HS256' } }],
    ['alg RS384', { header: { alg: 'RS384' } }],
    ['a missing alg', { header: { alg: undefined } }],
    ['a non-JWT JOSE type', { header: { typ: 'at+jwt' } }],
    ['a missing JOSE type', { header: { typ: undefined } }],
    ['a jku key source', { header: { jku: `${origin}/evil-jwks` } }],
    ['an x5u key source', { header: { x5u: `${origin}/evil-cert` } }],
    ['a missing kid', { header: { kid: undefined } }],
  ];

  for (const [name, options] of headerRejections) {
    it(`rejects a token with ${name}`, async () => {
      const result = await verifierFor(testTrustConfig()).verify(
        mintToken(options),
        SESSION_BINDING,
      );
      expectRejected(result, 401, 'AUTHENTICATION_REQUIRED');
      // No alternate key source is ever fetched.
      expect(fetchedPaths).not.toContain('/evil-jwks');
      expect(fetchedPaths).not.toContain('/evil-cert');
    });
  }

  it('rejects an oversized JWT and a malformed JWT without any fetch', async () => {
    const verifier = verifierFor(testTrustConfig());
    const oversized = await verifier.verify(
      mintToken({ claims: { padding: 'a'.repeat(20_000) } }),
      SESSION_BINDING,
    );
    expectRejected(oversized, 401, 'AUTHENTICATION_REQUIRED');
    const malformed = await verifier.verify('not-a-jwt', SESSION_BINDING);
    expectRejected(malformed, 401, 'AUTHENTICATION_REQUIRED');
    const twoSegments = await verifier.verify('aGVhZGVy.cGF5bG9hZA', SESSION_BINDING);
    expectRejected(twoSegments, 401, 'AUTHENTICATION_REQUIRED');
    expect(fetchedPaths).toEqual([]);
  });

  it('rejects a session binding shorter than 32 bytes', async () => {
    const result = await verifierFor(testTrustConfig()).verify(mintToken(), Buffer.alloc(31, 3));
    expectRejected(result, 401, 'AUTHENTICATION_REQUIRED');
  });

  it('refreshes at most once per 30s for an unknown key id, then rejects', async () => {
    const verifier = verifierFor(testTrustConfig());
    await verifier.verify(mintToken(), SESSION_BINDING);
    expect(certsFetches).toBe(1);

    const unknownKid = mintToken({ header: { kid: 'rotated-key' } });
    // Inside the cache TTL and outside the 30s refresh window: one refresh.
    nowMs += 31_000;
    expectRejected(
      await verifier.verify(unknownKid, SESSION_BINDING),
      401,
      'AUTHENTICATION_REQUIRED',
    );
    expect(certsFetches).toBe(2);

    // The refresh window is now closed: the next attempt fetches nothing.
    expectRejected(
      await verifier.verify(unknownKid, SESSION_BINDING),
      401,
      'AUTHENTICATION_REQUIRED',
    );
    expect(certsFetches).toBe(2);
  });

  it('reports 503 when the JWKS is unreachable and no key is cached', async () => {
    certsStatus = 500;
    const result = await verifierFor(testTrustConfig()).verify(mintToken(), SESSION_BINDING);
    expectRejected(result, 503, 'DEPENDENCY_UNAVAILABLE');
  });

  it('reports 503 for an oversized JWKS response', async () => {
    certsBody = JSON.stringify({
      keys: [{ ...jwk, kid: KID }],
      padding: 'a'.repeat(70_000),
    });
    const result = await verifierFor(testTrustConfig()).verify(mintToken(), SESSION_BINDING);
    expectRejected(result, 503, 'DEPENDENCY_UNAVAILABLE');
  });

  it('reports 503 for a JWKS with too many keys or no usable key', async () => {
    certsBody = JSON.stringify({
      keys: Array.from({ length: 65 }, (_entry, index) => ({ ...jwk, kid: `k${index}` })),
    });
    expectRejected(
      await verifierFor(testTrustConfig()).verify(mintToken(), SESSION_BINDING),
      503,
      'DEPENDENCY_UNAVAILABLE',
    );

    certsBody = JSON.stringify({ keys: [{ ...jwk, kid: KID, use: 'enc' }] });
    expectRejected(
      await verifierFor(testTrustConfig()).verify(mintToken(), SESSION_BINDING),
      503,
      'DEPENDENCY_UNAVAILABLE',
    );
  });

  it('reports 503 when the discovery issuer does not match the configured issuer', async () => {
    discoveryDocument = { issuer: 'https://other.example', jwks_uri: certsUrl };
    const result = await verifierFor(testTrustConfig()).verify(mintToken(), SESSION_BINDING);
    expectRejected(result, 503, 'DEPENDENCY_UNAVAILABLE');
    expect(fetchedPaths).not.toContain(CERTS_PATH);
  });

  it('refuses a JWKS endpoint outside the OIDC allowlist without fetching it', async () => {
    const config = testTrustConfig({ allowCerts: false });
    const result = await verifierFor(config).verify(mintToken(), SESSION_BINDING);
    expectRejected(result, 503, 'DEPENDENCY_UNAVAILABLE');
    expect(fetchedPaths).toEqual([DISCOVERY_PATH]);
  });

  it('reports 503 when the discovery document itself is unavailable', async () => {
    discoveryDocument = { issuer };
    const result = await verifierFor(testTrustConfig()).verify(mintToken(), SESSION_BINDING);
    expectRejected(result, 503, 'DEPENDENCY_UNAVAILABLE');
  });
});

describe('workspace technical headers', () => {
  const config = () => testTrustConfig();
  const bindingHeader = (value: string): WorkspaceHeaders => ({
    [SESSION_BINDING_HEADER]: value,
    [TRUST_CONFIG_HASH_HEADER]: config().trustConfigHash,
  });

  it('accepts the base64url session binding and the matching trust hash', () => {
    const trustConfig = config();
    const verifier = verifierFor(trustConfig);
    const result = verifier.verifySessionBindingHeaders({
      'X-Workspace-Session-Binding': SESSION_BINDING.toString('base64url'),
      [TRUST_CONFIG_HASH_HEADER]: trustConfig.trustConfigHash,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessionBinding.equals(SESSION_BINDING)).toBe(true);
  });

  it('rejects a missing or mismatched trust binding as unauthenticated', () => {
    const verifier = verifierFor(config());
    expect(verifier.verifySessionBindingHeaders({})).toEqual({
      ok: false,
      code: 'AUTHENTICATION_REQUIRED',
      status: 401,
    });
    expect(
      verifier.verifySessionBindingHeaders({
        [SESSION_BINDING_HEADER]: SESSION_BINDING.toString('base64url'),
      }),
    ).toEqual({ ok: false, code: 'AUTHENTICATION_REQUIRED', status: 401 });
    expect(
      verifier.verifySessionBindingHeaders({
        [SESSION_BINDING_HEADER]: SESSION_BINDING.toString('base64url'),
        [TRUST_CONFIG_HASH_HEADER]: 'a'.repeat(64),
      }),
    ).toEqual({ ok: false, code: 'AUTHENTICATION_REQUIRED', status: 401 });
  });

  it('rejects a malformed, short, duplicated or browser-override header as bad input', () => {
    const verifier = verifierFor(config());
    const badInput = { ok: false, code: 'API_VALUE_INVALID', status: 400 };
    expect(verifier.verifySessionBindingHeaders(bindingHeader('***'))).toEqual(badInput);
    expect(verifier.verifySessionBindingHeaders(bindingHeader('AAAA'))).toEqual(badInput);
    expect(
      verifier.verifySessionBindingHeaders({
        [SESSION_BINDING_HEADER]: [
          SESSION_BINDING.toString('base64url'),
          SESSION_BINDING.toString('base64url'),
        ],
        [TRUST_CONFIG_HASH_HEADER]: config().trustConfigHash,
      }),
    ).toEqual(badInput);
    expect(
      verifier.verifySessionBindingHeaders({
        ...bindingHeader(SESSION_BINDING.toString('base64url')),
        'x-actor': 'principal:someone-else',
      }),
    ).toEqual(badInput);
    expect(
      verifier.verifySessionBindingHeaders({
        [SESSION_BINDING_HEADER]: Buffer.alloc(31, 1).toString('base64url'),
        [TRUST_CONFIG_HASH_HEADER]: config().trustConfigHash,
      }),
    ).toEqual(badInput);
  });
});
