import { describe, expect, it } from 'vitest';
import {
  LOGIN_COOKIE,
  PUBLIC_HOST,
  PUBLIC_ORIGIN,
  SESSION_COOKIE,
  cookieFrom,
  cookieHeader,
  createTestStack,
  headerValue,
  login,
} from './testing/harness.js';

const QUERY_ID = '01920000-0000-7000-8000-000000000001';
const CORRELATION_ID = '01920000-0000-7000-8000-000000000002';
const DISCOVERY_OPERATION = 'project.find_workspace_projects';

const itSlow = (name: string, fn: () => Promise<void>) => {
  it(name, fn, 30_000);
};

function pathOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function queryBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    queryId: QUERY_ID,
    type: DISCOVERY_OPERATION,
    version: '1.0',
    scopeRef: {},
    consistencyRequirement: 'AUTHORITATIVE',
    pagination: { pageSize: 50 },
    correlationId: CORRELATION_ID,
    requestedAt: '2026-10-10T00:00:00.000Z',
    payload: {},
    integrity: null,
    ...overrides,
  };
}

interface SessionState {
  sessionCookie: string;
  csrfToken: string;
  sessionGeneration: string;
}

async function establishSession(
  stack: Awaited<ReturnType<typeof createTestStack>>,
  returnTo = '/workbench',
): Promise<SessionState> {
  const started = await login(stack, returnTo);
  const callback = await stack.inject({
    method: 'GET',
    url: pathOf(started.callbackUrl),
    cookie: cookieHeader(LOGIN_COOKIE, started.loginCookie),
  });
  expect(callback.status).toBe(302);
  const sessionCookie = cookieFrom(callback, SESSION_COOKIE);
  expect(sessionCookie.length).toBeGreaterThan(0);
  const session = await stack.inject({
    method: 'GET',
    url: '/bff/session',
    cookie: cookieHeader(SESSION_COOKIE, sessionCookie),
  });
  expect(session.status).toBe(200);
  const body = session.json as Record<string, unknown>;
  expect(body.accessState).toBe('ALLOWED');
  return {
    sessionCookie,
    csrfToken: String(body.csrfToken),
    sessionGeneration: String(body.sessionGeneration),
  };
}

function businessHeaders(session: SessionState, extra: Record<string, string> = {}) {
  return {
    origin: PUBLIC_ORIGIN,
    host: PUBLIC_HOST,
    'content-type': 'application/json',
    'x-csrf-token': session.csrfToken,
    ...extra,
  };
}

describe('trusted human session', () => {
  itSlow('completes login, exposes the session, and logs out locally first', async () => {
    const stack = await createTestStack({ now: { value: Date.now() } });
    try {
      const started = await login(stack);
      const authorize = new URL(started.authorizeUrl);
      expect(authorize.searchParams.get('response_type')).toBe('code');
      expect(authorize.searchParams.get('response_mode')).toBe('query');
      expect(authorize.searchParams.get('scope')).toContain('openid');
      expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
      expect(authorize.searchParams.get('nonce')).toBeTruthy();

      const callback = await stack.inject({
        method: 'GET',
        url: pathOf(started.callbackUrl),
        cookie: cookieHeader(LOGIN_COOKIE, started.loginCookie),
      });
      expect(callback.status).toBe(302);
      expect(headerValue(callback, 'location')).toBe('/workbench');
      const sessionCookie = cookieFrom(callback, SESSION_COOKIE);
      expect(sessionCookie.length).toBeGreaterThan(20);
      expect(cookieFrom(callback, LOGIN_COOKIE)).toBe('');

      const session = await stack.inject({
        method: 'GET',
        url: '/bff/session',
        cookie: cookieHeader(SESSION_COOKIE, sessionCookie),
      });
      expect(session.headers['cache-control']).toBe('no-store');
      expect(session.headers['referrer-policy']).toBe('no-referrer');
      expect(session.headers['x-content-type-options']).toBe('nosniff');
      const body = session.json as Record<string, unknown>;
      expect(body.accessState).toBe('ALLOWED');
      expect(body.businessActionsEnabled).toBe(true);
      expect(body.principal).toMatchObject({
        principalId: '01920000-0000-7000-8000-0000000000aa',
        principalKind: 'HUMAN',
        displayName: 'Synthetic Human',
      });
      expect(String(body.idleExpiresAt)).toMatch(/Z$/u);

      // Anonymous reads never leak a session.
      const anonymous = await stack.inject({ method: 'GET', url: '/bff/session' });
      expect(anonymous.status).toBe(200);
      expect(anonymous.json).toEqual({
        accessState: 'REAUTH_REQUIRED',
        businessActionsEnabled: false,
      });
      const bootstrap = await stack.inject({ method: 'GET', url: '/bff/bootstrap' });
      expect(bootstrap.json).toEqual({
        accessState: 'REAUTH_REQUIRED',
        businessActionsEnabled: false,
      });

      const csrfToken = String(body.csrfToken);
      const activity = await stack.inject({
        method: 'POST',
        url: '/bff/session/activity',
        cookie: cookieHeader(SESSION_COOKIE, sessionCookie),
        headers: businessHeaders({ sessionCookie, csrfToken, sessionGeneration: '' }),
      });
      expect(activity.status).toBe(200);
      expect((activity.json as Record<string, unknown>).extended).toBe(false);

      const logout = await stack.inject({
        method: 'POST',
        url: '/bff/auth/logout',
        cookie: cookieHeader(SESSION_COOKIE, sessionCookie),
        headers: businessHeaders({ sessionCookie, csrfToken, sessionGeneration: '' }),
      });
      expect(logout.status).toBe(200);
      expect(logout.json).toEqual({
        accessState: 'REAUTH_REQUIRED',
        businessActionsEnabled: false,
      });
      expect(cookieFrom(logout, SESSION_COOKIE)).toBe('');
      expect(stack.provider.revocationRequests).toBe(1);

      const after = await stack.inject({
        method: 'GET',
        url: '/bff/session',
        cookie: cookieHeader(SESSION_COOKIE, sessionCookie),
      });
      expect((after.json as Record<string, unknown>).accessState).toBe('SESSION_EXPIRED');
    } finally {
      await stack.close();
    }
  });

  itSlow('maps an IdP error callback to a fixed safe redirect', async () => {
    const stack = await createTestStack({ now: { value: Date.now() } });
    try {
      stack.provider.authorizeError = true;
      const started = await login(stack, '/projects/p-1');
      const callback = await stack.inject({
        method: 'GET',
        url: pathOf(started.callbackUrl),
        cookie: cookieHeader(LOGIN_COOKIE, started.loginCookie),
      });
      expect(callback.status).toBe(302);
      const location = headerValue(callback, 'location');
      expect(location).toBe('/projects/p-1?error=UI_REAUTH_REQUIRED');
      expect(location).not.toContain('access_denied');
      expect(cookieFrom(callback, LOGIN_COOKIE)).toBe('');
      expect(cookieFrom(callback, SESSION_COOKIE)).toBe('');
      expect(stack.provider.tokenRequests).toHaveLength(0);
      expect(stack.core.requests).toHaveLength(0);

      // The same iss binding applies to error callbacks.
      const second = await login(stack);
      const tampered = new URL(second.callbackUrl);
      tampered.searchParams.set('iss', 'https://evil.example');
      const tamperedCallback = await stack.inject({
        method: 'GET',
        url: pathOf(tampered.toString()),
        cookie: cookieHeader(LOGIN_COOKIE, second.loginCookie),
      });
      expect(tamperedCallback.status).toBe(400);
      expect(stack.provider.tokenRequests).toHaveLength(0);
    } finally {
      await stack.close();
    }
  });

  itSlow('rejects missing, empty, mismatched and duplicated iss without consuming', async () => {
    const stack = await createTestStack({ now: { value: Date.now() } });
    try {
      const started = await login(stack);
      const cookie = cookieHeader(LOGIN_COOKIE, started.loginCookie);
      const callback = new URL(started.callbackUrl);
      const code = encodeURIComponent(callback.searchParams.get('code') ?? '');
      const state = encodeURIComponent(callback.searchParams.get('state') ?? '');
      const iss = encodeURIComponent(callback.searchParams.get('iss') ?? '');
      const variants = [
        `?code=${code}&state=${state}`,
        `?code=${code}&state=${state}&iss=`,
        `?code=${code}&state=${state}&iss=${encodeURIComponent('https://evil.example')}`,
        `?code=${code}&state=${state}&iss=${iss}&iss=${iss}`,
        `?code=${code}&state=${state}&iss=${iss}&session_state=${'a'.repeat(1100)}`,
        `?code=${code}&state=${state}&iss=${iss}&${'x'.repeat(16 * 1024)}=1`,
        `?code=${code}&state=${state}&iss=${iss}&unknown=${'a'.repeat(20)}`,
        `?code=${code}&state=${state}&iss=${iss}&session_state=`,
      ];
      for (const search of variants) {
        const rejected = await stack.inject({
          method: 'GET',
          url: `/bff/auth/callback${search}`,
          cookie,
        });
        expect(rejected.status, `variant ${search}`).toBe(400);
        expect((rejected.json as Record<string, unknown>).code).toBe('UI_REAUTH_REQUIRED');
      }
      // None of the rejected attempts consumed the still-valid transaction.
      const accepted = await stack.inject({
        method: 'GET',
        url: pathOf(started.callbackUrl),
        cookie,
      });
      expect(accepted.status).toBe(302);
      expect(cookieFrom(accepted, SESSION_COOKIE).length).toBeGreaterThan(0);
    } finally {
      await stack.close();
    }
  });

  itSlow('rejects replayed, unknown, expired and unbound callbacks', async () => {
    const stack = await createTestStack({ now: { value: Date.now() } });
    try {
      const replayed = await login(stack);
      const first = await stack.inject({
        method: 'GET',
        url: pathOf(replayed.callbackUrl),
        cookie: cookieHeader(LOGIN_COOKIE, replayed.loginCookie),
      });
      expect(first.status).toBe(302);
      const replay = await stack.inject({
        method: 'GET',
        url: pathOf(replayed.callbackUrl),
        cookie: cookieHeader(LOGIN_COOKIE, replayed.loginCookie),
      });
      expect(replay.status).toBe(400);

      const unknownUrl = new URL(replayed.callbackUrl);
      unknownUrl.searchParams.set('state', 'unknown-state');
      const unknown = await stack.inject({
        method: 'GET',
        url: pathOf(unknownUrl.toString()),
        cookie: cookieHeader(LOGIN_COOKIE, replayed.loginCookie),
      });
      expect(unknown.status).toBe(400);

      const unbound = await login(stack);
      const wrongCookie = await stack.inject({
        method: 'GET',
        url: pathOf(unbound.callbackUrl),
        cookie: cookieHeader(LOGIN_COOKIE, 'not-the-bound-binding-id'),
      });
      expect(wrongCookie.status).toBe(400);
      // The rightful browser still wins the transaction.
      const rightCookie = await stack.inject({
        method: 'GET',
        url: pathOf(unbound.callbackUrl),
        cookie: cookieHeader(LOGIN_COOKIE, unbound.loginCookie),
      });
      expect(rightCookie.status).toBe(302);

      const missingCookie = await login(stack);
      const noCookie = await stack.inject({
        method: 'GET',
        url: pathOf(missingCookie.callbackUrl),
      });
      expect(noCookie.status).toBe(400);

      const expired = await login(stack);
      stack.now.value += 6 * 60 * 1000;
      const late = await stack.inject({
        method: 'GET',
        url: pathOf(expired.callbackUrl),
        cookie: cookieHeader(LOGIN_COOKIE, expired.loginCookie),
      });
      expect(late.status).toBe(400);
    } finally {
      await stack.close();
    }
  });

  itSlow('rejects a PKCE mismatch with zero session and zero bootstrap', async () => {
    const stack = await createTestStack({ now: { value: Date.now() } });
    try {
      stack.provider.codeChallengeOverride = 'wrong-challenge';
      const started = await login(stack);
      const callback = await stack.inject({
        method: 'GET',
        url: pathOf(started.callbackUrl),
        cookie: cookieHeader(LOGIN_COOKIE, started.loginCookie),
      });
      expect(callback.status).toBe(401);
      expect((callback.json as Record<string, unknown>).code).toBe('UI_REAUTH_REQUIRED');
      expect(cookieFrom(callback, SESSION_COOKIE)).toBe('');
      expect(stack.core.requests).toHaveLength(0);
    } finally {
      await stack.close();
    }
  });

  itSlow(
    'rejects mismatched subject, wrong azp, wrong aud and an ID token as API token',
    async () => {
      const cases: Record<string, unknown>[] = [
        { accessTokenTemplate: { header: {}, claims: { sub: 'other-human' } } },
        { idTokenTemplate: { header: {}, claims: { azp: 'other-client' } } },
        { idTokenTemplate: { header: {}, claims: { aud: 'other-audience' } } },
        { accessTokenTemplate: { header: {}, claims: { typ: undefined } } },
        {
          idTokenTemplate: {
            header: {},
            claims: {
              iat: Math.floor(Date.now() / 1000) - 2000,
              exp: Math.floor(Date.now() / 1000) - 1000,
            },
          },
        },
        { idTokenTemplate: { header: { alg: 'HS256' }, claims: {} } },
        { accessTokenTemplate: { header: {}, claims: { iss: 'https://evil.example' } } },
        {
          accessTokenTemplate: {
            header: {},
            claims: { exp: Math.floor(Date.now() / 1000) + 5000 },
          },
        },
      ];
      const stack = await createTestStack({ now: { value: Date.now() } });
      try {
        for (const [index, override] of cases.entries()) {
          stack.provider.idTokenTemplate = { header: {}, claims: {} };
          stack.provider.accessTokenTemplate = { header: {}, claims: {} };
          const key = Object.keys(override)[0] as 'idTokenTemplate' | 'accessTokenTemplate';
          Object.assign(stack.provider[key], override[key]);
          const started = await login(stack);
          const callback = await stack.inject({
            method: 'GET',
            url: pathOf(started.callbackUrl),
            cookie: cookieHeader(LOGIN_COOKIE, started.loginCookie),
          });
          expect(callback.status, `case ${index}`).toBe(401);
          expect(cookieFrom(callback, SESSION_COOKIE)).toBe('');
          expect(stack.core.requests, `case ${index}`).toHaveLength(0);
        }
      } finally {
        await stack.close();
      }
    },
  );

  itSlow('refreshes JWKS once for an unknown kid and then fails closed', async () => {
    const stack = await createTestStack({ now: { value: Date.now() } });
    try {
      const first = await establishSession(stack);
      expect(first.sessionCookie.length).toBeGreaterThan(0);
      const initialFetches = stack.provider.jwksRequests;

      stack.now.value += 31_000;
      stack.provider.jwksKids = ['kid-1', 'kid-2'];
      stack.provider.idTokenTemplate.header = { kid: 'kid-2' };
      const rotated = await login(stack);
      const rotatedCallback = await stack.inject({
        method: 'GET',
        url: pathOf(rotated.callbackUrl),
        cookie: cookieHeader(LOGIN_COOKIE, rotated.loginCookie),
      });
      expect(rotatedCallback.status).toBe(302);
      expect(stack.provider.jwksRequests).toBe(initialFetches + 1);

      // A second unknown kid inside the same 30s window is not refreshed again.
      stack.provider.idTokenTemplate.header = { kid: 'kid-3' };
      const nextLogin = await login(stack);
      const unknownKid = await stack.inject({
        method: 'GET',
        url: pathOf(nextLogin.callbackUrl),
        cookie: cookieHeader(LOGIN_COOKIE, nextLogin.loginCookie),
      });
      expect(unknownKid.status).toBe(401);
      expect(stack.provider.jwksRequests).toBe(initialFetches + 1);
    } finally {
      await stack.close();
    }
  });

  itSlow('accepts only the frozen session-bootstrap shape', async () => {
    const acceptedRef = {
      kind: 'OBJECT',
      objectType: 'identity.principal',
      objectId: '01920000-0000-7000-8000-0000000000aa',
      scope: { enterpriseId: '01920000-0000-7000-8000-0000000000ee' },
    };
    const rejectedBodies: unknown[] = [
      { principal: { principalId: '01920000-0000-7000-8000-0000000000aa' } },
      { principalId: '01920000-0000-7000-8000-0000000000aa' },
      { principalRef: acceptedRef, principalKind: 'HUMAN', status: 'ACTIVE' },
      { principalRef: acceptedRef, principalKind: 'SERVICE', status: 'ACTIVE', displayName: 'X' },
      { principalRef: acceptedRef, principalKind: 'HUMAN', status: 'SUSPENDED', displayName: 'X' },
      {
        principalRef: { ...acceptedRef, objectId: 'not-a-uuid' },
        principalKind: 'HUMAN',
        status: 'ACTIVE',
        displayName: 'X',
      },
      { principalRef: acceptedRef, principalKind: 'HUMAN', status: 'ACTIVE', displayName: '' },
      {
        principalRef: 'identity.principal',
        principalKind: 'HUMAN',
        status: 'ACTIVE',
        displayName: 'X',
      },
    ];

    const stack = await createTestStack({ now: { value: Date.now() } });
    try {
      stack.core.bootstrapBody = {
        principalRef: acceptedRef,
        principalKind: 'HUMAN',
        status: 'ACTIVE',
        displayName: 'Synthetic Human',
      };
      const accepted = await establishSession(stack);
      expect(accepted.sessionCookie.length).toBeGreaterThan(0);

      for (const [index, body] of rejectedBodies.entries()) {
        stack.core.bootstrapBody = body;
        const started = await login(stack);
        const callback = await stack.inject({
          method: 'GET',
          url: pathOf(started.callbackUrl),
          cookie: cookieHeader(LOGIN_COOKIE, started.loginCookie),
        });
        expect(callback.status, `body ${index}`).toBe(503);
        expect(cookieFrom(callback, SESSION_COOKIE), `body ${index}`).toBe('');
      }
    } finally {
      await stack.close();
    }
  });

  itSlow('denies an authenticated principal without an ACTIVE linked HUMAN', async () => {
    const stack = await createTestStack({ now: { value: Date.now() } });
    try {
      stack.core.bootstrapStatus = 403;
      stack.core.bootstrapBody = {
        code: 'ACCESS_DENIED',
        message: 'No linked workspace identity.',
        retryable: false,
      };
      const started = await login(stack);
      const callback = await stack.inject({
        method: 'GET',
        url: pathOf(started.callbackUrl),
        cookie: cookieHeader(LOGIN_COOKIE, started.loginCookie),
      });
      expect(callback.status).toBe(403);
      expect((callback.json as Record<string, unknown>).code).toBe('ACCESS_DENIED');
      expect(cookieFrom(callback, SESSION_COOKIE)).toBe('');
    } finally {
      await stack.close();
    }
  });

  itSlow('fails closed at capacity without evicting the active session', async () => {
    const stack = await createTestStack({
      now: { value: Date.now() },
      trustOverrides: { maxLoginTransactions: 1 },
    });
    try {
      const active = await login(stack);
      const capacity = await stack.inject({
        method: 'GET',
        url: '/bff/auth/login?returnTo=%2Fworkbench',
      });
      expect(capacity.status).toBe(503);
      expect((capacity.json as Record<string, unknown>).code).toBe('UI_SERVICE_NOT_CONFIGURED');
      const callback = await stack.inject({
        method: 'GET',
        url: pathOf(active.callbackUrl),
        cookie: cookieHeader(LOGIN_COOKIE, active.loginCookie),
      });
      expect(callback.status).toBe(302);
    } finally {
      await stack.close();
    }
  });

  itSlow('refuses a new session when the session capacity is full', async () => {
    const stack = await createTestStack({
      now: { value: Date.now() },
      trustOverrides: { maxSessions: 1 },
    });
    try {
      const session = await establishSession(stack);
      const second = await login(stack);
      const callback = await stack.inject({
        method: 'GET',
        url: pathOf(second.callbackUrl),
        cookie: cookieHeader(LOGIN_COOKIE, second.loginCookie),
      });
      expect(callback.status).toBe(503);
      expect(cookieFrom(callback, SESSION_COOKIE)).toBe('');
      const stillValid = await stack.inject({
        method: 'GET',
        url: '/bff/session',
        cookie: cookieHeader(SESSION_COOKIE, session.sessionCookie),
      });
      expect((stillValid.json as Record<string, unknown>).accessState).toBe('ALLOWED');
    } finally {
      await stack.close();
    }
  });

  itSlow('refuses a login beyond the per-browser transaction limit', async () => {
    const stack = await createTestStack({
      now: { value: Date.now() },
      trustOverrides: { maxTransactionsPerBrowser: 1 },
    });
    try {
      const first = await login(stack);
      const second = await stack.inject({
        method: 'GET',
        url: '/bff/auth/login?returnTo=%2Fworkbench',
        cookie: cookieHeader(LOGIN_COOKIE, first.loginCookie),
      });
      expect(second.status).toBe(503);
      const callback = await stack.inject({
        method: 'GET',
        url: pathOf(first.callbackUrl),
        cookie: cookieHeader(LOGIN_COOKIE, first.loginCookie),
      });
      expect(callback.status).toBe(302);
    } finally {
      await stack.close();
    }
  });

  itSlow('fails closed when Core identity bootstrap is unavailable', async () => {
    const stack = await createTestStack({ now: { value: Date.now() } });
    try {
      await stack.core.stop();
      const started = await login(stack);
      const callback = await stack.inject({
        method: 'GET',
        url: pathOf(started.callbackUrl),
        cookie: cookieHeader(LOGIN_COOKIE, started.loginCookie),
      });
      expect(callback.status).toBe(503);
      expect((callback.json as Record<string, unknown>).code).toBe('UI_SERVICE_NOT_CONFIGURED');
      expect(cookieFrom(callback, SESSION_COOKIE)).toBe('');
    } finally {
      await stack.close();
    }
  });

  itSlow('honors forwarded fields only from an allowlisted proxy peer', async () => {
    const stack = await createTestStack({
      now: { value: Date.now() },
      trustOverrides: { trustedProxyPeers: ['127.0.0.1/32', '::1/128'] },
    });
    try {
      const session = await establishSession(stack);
      const cookie = cookieHeader(SESSION_COOKIE, session.sessionCookie);
      const activity = (headers: Record<string, string>, remoteAddress: string) =>
        stack.inject({
          method: 'POST',
          url: '/bff/session/activity',
          cookie,
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': session.csrfToken,
            ...headers,
          },
          remoteAddress,
        });

      // A non-peer cannot widen Host/Origin with forwarded headers.
      const nonPeerForwarded = await activity(
        {
          host: 'internal:9999',
          origin: 'http://internal:9999',
          'x-forwarded-host': PUBLIC_HOST,
          'x-forwarded-proto': 'http',
        },
        '203.0.113.9',
      );
      expect(nonPeerForwarded.status).toBe(403);
      expect((nonPeerForwarded.json as Record<string, unknown>).code).toBe('UI_ORIGIN_REJECTED');

      // Forwarded headers from a non-peer are ignored entirely.
      const nonPeerIgnored = await activity(
        {
          host: PUBLIC_HOST,
          origin: PUBLIC_ORIGIN,
          'x-forwarded-host': 'evil.example',
          'x-forwarded-proto': 'https',
        },
        '203.0.113.9',
      );
      expect(nonPeerIgnored.status).toBe(200);

      // An allowlisted peer resolves the effective origin/host from the pair.
      const peerHonored = await activity(
        {
          host: 'internal:9999',
          origin: 'http://internal:9999',
          'x-forwarded-host': PUBLIC_HOST,
          'x-forwarded-proto': 'http',
        },
        '127.0.0.1',
      );
      expect(peerHonored.status).toBe(200);

      // The mapped IPv6 spelling of an allowlisted IPv4 peer behaves the same.
      const mappedPeer = await activity(
        {
          host: 'internal:9999',
          origin: 'http://internal:9999',
          'x-forwarded-host': PUBLIC_HOST,
          'x-forwarded-proto': 'http',
        },
        '::ffff:127.0.0.1',
      );
      expect(mappedPeer.status).toBe(200);

      // A forwarded value pointing at another origin is still rejected.
      const otherOrigin = await activity(
        {
          host: PUBLIC_HOST,
          origin: PUBLIC_ORIGIN,
          'x-forwarded-host': 'evil.example',
          'x-forwarded-proto': 'http',
        },
        '127.0.0.1',
      );
      expect(otherOrigin.status).toBe(403);

      // A multi-valued forwarded host is not sliced: the direct values apply.
      const multiValued = await activity(
        {
          host: 'internal:9999',
          origin: 'http://internal:9999',
          'x-forwarded-host': `${PUBLIC_HOST}, evil.example`,
          'x-forwarded-proto': 'http',
        },
        '127.0.0.1',
      );
      expect(multiValued.status).toBe(403);

      // Without a well-formed pair the peer falls back to the direct values.
      const noProto = await activity(
        {
          host: PUBLIC_HOST,
          origin: PUBLIC_ORIGIN,
          'x-forwarded-host': 'evil.example',
        },
        '127.0.0.1',
      );
      expect(noProto.status).toBe(200);
    } finally {
      await stack.close();
    }
  });

  itSlow('proxies an allowlisted query with trusted headers only', async () => {
    const stack = await createTestStack({ now: { value: Date.now() } });
    try {
      const session = await establishSession(stack);
      const response = await stack.inject({
        method: 'POST',
        url: `/bff/queries/${DISCOVERY_OPERATION}/1.0`,
        cookie: cookieHeader(SESSION_COOKIE, session.sessionCookie),
        headers: businessHeaders(session),
        payload: JSON.stringify(queryBody()),
      });
      expect(response.status).toBe(200);
      expect((response.json as Record<string, unknown>).status).toBe('OK');
      expect(response.headers['cache-control']).toBe('no-store');
      const forwarded = stack.core.requests.at(-1) as unknown as Record<string, unknown>;
      expect(forwarded.path).toBe(`/api/queries/${DISCOVERY_OPERATION}/1.0`);
      const headers = forwarded.headers as Record<string, string>;
      expect(headers.authorization).toMatch(/^Bearer /u);
      expect(headers['x-workspace-trust-config-hash']).toMatch(/^[0-9a-f]{64}$/u);
      expect(String(headers['x-workspace-session-binding']).length).toBeGreaterThan(20);
      expect(forwarded.body).toContain(QUERY_ID);
    } finally {
      await stack.close();
    }
  });

  itSlow(
    'rejects override fields, override headers, unknown operations and mismatches',
    async () => {
      const stack = await createTestStack({ now: { value: Date.now() } });
      try {
        const session = await establishSession(stack);
        const url = `/bff/queries/${DISCOVERY_OPERATION}/1.0`;
        const cookie = cookieHeader(SESSION_COOKIE, session.sessionCookie);

        const overrideField = await stack.inject({
          method: 'POST',
          url,
          cookie,
          headers: businessHeaders(session),
          payload: JSON.stringify(queryBody({ roles: ['ADMIN'] })),
        });
        expect(overrideField.status).toBe(400);

        const overrideHeader = await stack.inject({
          method: 'POST',
          url,
          cookie,
          headers: businessHeaders(session, { authorization: 'Bearer forged' }),
          payload: JSON.stringify(queryBody()),
        });
        expect(overrideHeader.status).toBe(400);

        const sessionBindingHeader = await stack.inject({
          method: 'POST',
          url,
          cookie,
          headers: businessHeaders(session, { 'x-workspace-session-binding': 'forged' }),
          payload: JSON.stringify(queryBody()),
        });
        expect(sessionBindingHeader.status).toBe(400);

        const typeMismatch = await stack.inject({
          method: 'POST',
          url,
          cookie,
          headers: businessHeaders(session),
          payload: JSON.stringify(queryBody({ type: 'project.get_project_board_slice' })),
        });
        expect(typeMismatch.status).toBe(400);

        const versionMismatch = await stack.inject({
          method: 'POST',
          url,
          cookie,
          headers: businessHeaders(session),
          payload: JSON.stringify(queryBody({ version: '2.0' })),
        });
        expect(versionMismatch.status).toBe(400);

        const encodedPath = await stack.inject({
          method: 'POST',
          url: `/bff/queries/${DISCOVERY_OPERATION}%2F1.0/1.0`,
          cookie,
          headers: businessHeaders(session),
          payload: JSON.stringify(queryBody()),
        });
        expect(encodedPath.status).toBe(400);

        const unregistered = await stack.inject({
          method: 'POST',
          url: '/bff/queries/identity.link_external_identity/1.0',
          cookie,
          headers: businessHeaders(session),
          payload: JSON.stringify(
            queryBody({ type: 'identity.link_external_identity', version: '1.0' }),
          ),
        });
        expect(unregistered.status).toBe(404);

        const command = await stack.inject({
          method: 'POST',
          url: '/bff/commands/project.request_startup_confirmation/1.0',
          cookie,
          headers: businessHeaders(session),
          payload: JSON.stringify({
            commandId: QUERY_ID,
            type: 'project.request_startup_confirmation',
            version: '1.0',
            scopeRef: {},
            targetRef: {},
            idempotencyKey: 'key-1',
            correlationId: CORRELATION_ID,
            requestedAt: '2026-10-10T00:00:00.000Z',
            payload: {},
            integrity: null,
          }),
        });
        expect(command.status).toBe(503);
        expect((command.json as Record<string, unknown>).code).toBe('DEPENDENCY_UNAVAILABLE');

        const zip = await stack.inject({
          method: 'PUT',
          url: '/bff/customer-intakes/intake-1/zip',
          cookie,
          headers: businessHeaders(session, { 'content-type': 'application/zip' }),
        });
        expect(zip.status).toBe(404);
      } finally {
        await stack.close();
      }
    },
  );

  itSlow('enforces CSRF, Origin, Host, Content-Type and method on protected routes', async () => {
    const stack = await createTestStack({ now: { value: Date.now() } });
    try {
      const session = await establishSession(stack);
      const cookie = cookieHeader(SESSION_COOKIE, session.sessionCookie);
      const base = { origin: PUBLIC_ORIGIN, host: PUBLIC_HOST, 'content-type': 'application/json' };

      const noCsrf = await stack.inject({
        method: 'POST',
        url: '/bff/session/activity',
        cookie,
        headers: base,
      });
      expect(noCsrf.status).toBe(403);
      expect((noCsrf.json as Record<string, unknown>).code).toBe('UI_CSRF_REJECTED');

      const wrongCsrf = await stack.inject({
        method: 'POST',
        url: '/bff/session/activity',
        cookie,
        headers: { ...base, 'x-csrf-token': 'wrong' },
      });
      expect(wrongCsrf.status).toBe(403);

      const nullOrigin = await stack.inject({
        method: 'POST',
        url: '/bff/session/activity',
        cookie,
        headers: { ...base, origin: 'null', 'x-csrf-token': session.csrfToken },
      });
      expect(nullOrigin.status).toBe(403);
      expect((nullOrigin.json as Record<string, unknown>).code).toBe('UI_ORIGIN_REJECTED');

      const otherOrigin = await stack.inject({
        method: 'POST',
        url: '/bff/session/activity',
        cookie,
        headers: { ...base, origin: 'https://evil.example', 'x-csrf-token': session.csrfToken },
      });
      expect(otherOrigin.status).toBe(403);

      const badHost = await stack.inject({
        method: 'POST',
        url: '/bff/session/activity',
        cookie,
        headers: {
          ...base,
          host: 'evil.example',
          'x-csrf-token': session.csrfToken,
        },
      });
      expect(badHost.status).toBe(403);

      const wrongContentType = await stack.inject({
        method: 'POST',
        url: `/bff/queries/${DISCOVERY_OPERATION}/1.0`,
        cookie,
        headers: {
          ...businessHeaders(session),
          'content-type': 'text/plain',
        },
        payload: JSON.stringify(queryBody()),
      });
      expect(wrongContentType.status).toBe(415);

      const getAsWrite = await stack.inject({
        method: 'GET',
        url: `/bff/queries/${DISCOVERY_OPERATION}/1.0`,
        cookie,
        headers: businessHeaders(session),
      });
      expect(getAsWrite.status).toBe(405);

      const anonymous = await stack.inject({
        method: 'POST',
        url: '/bff/session/activity',
        headers: businessHeaders(session),
      });
      expect(anonymous.status).toBe(401);
      expect((anonymous.json as Record<string, unknown>).code).toBe('UI_REAUTH_REQUIRED');

      const duplicateCookie = await stack.inject({
        method: 'GET',
        url: '/bff/session',
        cookie: `${SESSION_COOKIE}=a; ${SESSION_COOKIE}=b`,
      });
      expect(duplicateCookie.status).toBe(400);
    } finally {
      await stack.close();
    }
  });

  itSlow('single-flights refresh and never resurrects a logged-out session', async () => {
    const stack = await createTestStack({ now: { value: Date.now() } });
    try {
      const session = await establishSession(stack);
      const cookie = cookieHeader(SESSION_COOKIE, session.sessionCookie);
      stack.now.value += 300_000;
      stack.provider.tokenDelayMs = 150;
      const query = () =>
        stack.inject({
          method: 'POST',
          url: `/bff/queries/${DISCOVERY_OPERATION}/1.0`,
          cookie,
          headers: businessHeaders(session),
          payload: JSON.stringify(queryBody()),
        });
      const [first, second] = await Promise.all([query(), query()]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const refreshRequests = stack.provider.tokenRequests.filter(
        (request) => request.grantType === 'refresh_token',
      );
      expect(refreshRequests).toHaveLength(1);

      // A refresh that lands after logout must not revive the session.
      stack.now.value += 300_000;
      const inFlight = query();
      const logout = await stack.inject({
        method: 'POST',
        url: '/bff/auth/logout',
        cookie,
        headers: businessHeaders(session),
      });
      expect(logout.status).toBe(200);
      const late = await inFlight;
      expect(late.status).toBe(401);
      const after = await stack.inject({ method: 'GET', url: '/bff/session', cookie });
      expect((after.json as Record<string, unknown>).accessState).toBe('SESSION_EXPIRED');
    } finally {
      await stack.close();
    }
  });

  itSlow('invalidates the session when a refresh times out', async () => {
    const stack = await createTestStack({
      now: { value: Date.now() },
      bff: { refreshWaitMs: 50 },
    });
    try {
      const session = await establishSession(stack);
      stack.now.value += 300_000;
      stack.provider.tokenDelayMs = 300;
      const completion = stack.provider.nextTokenCompletion();
      const response = await stack.inject({
        method: 'POST',
        url: `/bff/queries/${DISCOVERY_OPERATION}/1.0`,
        cookie: cookieHeader(SESSION_COOKIE, session.sessionCookie),
        headers: businessHeaders(session),
        payload: JSON.stringify(queryBody()),
      });
      expect(response.status).toBe(401);
      expect((response.json as Record<string, unknown>).code).toBe('UI_SESSION_EXPIRED');
      // Wait for the late refresh result, then prove it did not resurrect anything.
      await completion;
      const after = await stack.inject({
        method: 'GET',
        url: '/bff/session',
        cookie: cookieHeader(SESSION_COOKIE, session.sessionCookie),
      });
      expect((after.json as Record<string, unknown>).accessState).toBe('SESSION_EXPIRED');
    } finally {
      await stack.close();
    }
  });

  itSlow('invalidates the session when a refresh is rejected', async () => {
    const stack = await createTestStack({ now: { value: Date.now() } });
    try {
      const session = await establishSession(stack);
      const cookie = cookieHeader(SESSION_COOKIE, session.sessionCookie);
      stack.now.value += 300_000;
      stack.provider.refreshStatusOverride = 400;
      const response = await stack.inject({
        method: 'POST',
        url: `/bff/queries/${DISCOVERY_OPERATION}/1.0`,
        cookie,
        headers: businessHeaders(session),
        payload: JSON.stringify(queryBody()),
      });
      expect(response.status).toBe(401);
      expect((response.json as Record<string, unknown>).code).toBe('UI_SESSION_EXPIRED');
      const after = await stack.inject({ method: 'GET', url: '/bff/session', cookie });
      expect((after.json as Record<string, unknown>).accessState).toBe('SESSION_EXPIRED');
    } finally {
      await stack.close();
    }
  });

  itSlow('fails closed with 503 when Core is unreachable', async () => {
    const stack = await createTestStack({ now: { value: Date.now() } });
    try {
      const session = await establishSession(stack);
      await stack.core.stop();
      const response = await stack.inject({
        method: 'POST',
        url: `/bff/queries/${DISCOVERY_OPERATION}/1.0`,
        cookie: cookieHeader(SESSION_COOKIE, session.sessionCookie),
        headers: businessHeaders(session),
        payload: JSON.stringify(queryBody()),
      });
      expect(response.status).toBe(503);
      expect((response.json as Record<string, unknown>).code).toBe('DEPENDENCY_UNAVAILABLE');
    } finally {
      await stack.close();
    }
  });

  itSlow('passes Core errors through unchanged and adds a correlation id', async () => {
    const stack = await createTestStack({ now: { value: Date.now() } });
    try {
      const session = await establishSession(stack);
      stack.core.queryStatus = 409;
      stack.core.queryBody = {
        code: 'CONCURRENCY_CONFLICT',
        message: 'conflict',
        retryable: false,
        retryDisposition: 'MANUAL',
      };
      const response = await stack.inject({
        method: 'POST',
        url: `/bff/queries/${DISCOVERY_OPERATION}/1.0`,
        cookie: cookieHeader(SESSION_COOKIE, session.sessionCookie),
        headers: businessHeaders(session),
        payload: JSON.stringify(queryBody()),
      });
      expect(response.status).toBe(409);
      expect(response.json).toMatchObject({
        code: 'CONCURRENCY_CONFLICT',
        retryDisposition: 'MANUAL',
        correlationId: CORRELATION_ID,
      });
      expect(response.headers['x-correlation-id']).toBe(CORRELATION_ID);
    } finally {
      await stack.close();
    }
  });
});
