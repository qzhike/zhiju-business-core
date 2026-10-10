import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { httpStatusForBody, readJsonBody } from './body.js';
import { parseCallbackQuery, resolveReturnTo } from './callback-query.js';
import {
  LOGIN_COOKIE,
  SESSION_COOKIE,
  appendSetCookie,
  clearCookie,
  readSingleCookie,
  serializeCookie,
} from './cookies.js';
import {
  JSON_CONTENT_TYPE,
  ZIP_CONTENT_TYPE,
  contentTypeAllowed,
  csrfMatches,
  hostAllowed,
  issueCsrfToken,
  originAllowed,
} from './csrf.js';
import { JwtRejectedError } from './jwt.js';
import { OidcDependencyError, OidcRejectedError } from './oidc.js';
import type { FetchLike, OidcProvider } from './oidc.js';
import {
  OperationRequestError,
  assertNoOverrideHeaders,
  operationRegistered,
  parseOperationPath,
  validateCommandProjection,
  validateQueryProjection,
} from './operations.js';
import { peerListAllows } from './peers.js';
import type { SessionPrincipalSummary, SessionRecord, SessionStore } from './sessions.js';
import {
  CORE_ERROR,
  UI_ERROR,
  hasControlCharacters,
  isPlainObject,
  isUuidV7,
  randomToken,
  safeErrorBody,
  uuidV7,
} from './support.js';
import type { LoginTransactionStore } from './transactions.js';
import type { LoadedBffTrustConfig } from './trust-config.js';
import { verifiedIdentity, verifyAccessToken, verifyIdToken } from './verify.js';

const CORE_RESPONSE_LIMIT = 8 * 1024 * 1024;
const SESSION_BINDING_BYTES = 32;

export interface BffRouterContext {
  loaded: LoadedBffTrustConfig;
  provider: OidcProvider;
  transactions: LoginTransactionStore;
  sessions: SessionStore;
  now: () => number;
  fetchImpl: FetchLike;
  refreshWaitMs: number;
}

type SessionLookup =
  | { status: 'malformed' }
  | { status: 'none' }
  | { status: 'dead' }
  | { status: 'active'; record: SessionRecord };

function splitUrl(url: string): { path: string; rawQuery: string } {
  const index = url.indexOf('?');
  if (index === -1) return { path: url, rawQuery: '' };
  return { path: url.slice(0, index), rawQuery: url.slice(index + 1) };
}

function sendSafeError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  retryable: boolean,
): true {
  reply.status(status).send(safeErrorBody(code, message, retryable, uuidV7()));
  return true;
}

function iso(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

/** A forwarded field is usable only as one single value. */
const FORWARDED_HOST_PATTERN = /^[A-Za-z0-9.\-[\]:]{1,255}$/u;

function singleHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

function forwardedProto(header: string | string[] | undefined): string | undefined {
  const value = singleHeaderValue(header);
  if (value === undefined) return undefined;
  const candidate = value.trim().toLowerCase();
  return candidate === 'http' || candidate === 'https' ? candidate : undefined;
}

function forwardedHost(header: string | string[] | undefined): string | undefined {
  const value = singleHeaderValue(header);
  if (value === undefined || value.includes(',')) return undefined;
  const candidate = value.trim();
  return FORWARDED_HOST_PATTERN.test(candidate) ? candidate : undefined;
}

/**
 * Composes the BFF route handler. Every public request is resolved from one
 * canonical path parse; nothing here trusts a browser-supplied identity field.
 */
export function createRequestHandler(
  context: BffRouterContext,
): (request: FastifyRequest, reply: FastifyReply) => Promise<boolean> {
  const { loaded, provider, sessions, transactions } = context;
  const { config } = loaded;

  /**
   * The effective Origin/Host. Forwarded rewriting is honored only from an
   * allowlisted proxy peer, and only as single well-formed values; the result
   * is still compared exactly against publicOrigin/allowedHosts afterwards, so
   * a forwarded value can never widen the accepted Host/Origin set.
   */
  function effectiveTarget(request: FastifyRequest): {
    origin: string | undefined;
    host: string | undefined;
  } {
    const directOrigin = request.headers.origin;
    const directHost = request.headers.host;
    const remoteAddress = request.raw.socket.remoteAddress;
    if (remoteAddress === undefined || !peerListAllows(config.trustedProxyPeers, remoteAddress)) {
      return { origin: directOrigin, host: directHost };
    }
    const proto = forwardedProto(request.headers['x-forwarded-proto']);
    const host = forwardedHost(request.headers['x-forwarded-host']);
    if (proto === undefined || host === undefined) {
      return { origin: directOrigin, host: directHost };
    }
    return { origin: `${proto}://${host}`, host };
  }

  function lookupSession(request: FastifyRequest): SessionLookup {
    const cookie = readSingleCookie(request.headers.cookie, SESSION_COOKIE);
    if (cookie.status !== 'ok') return { status: 'malformed' };
    if (cookie.value === undefined) return { status: 'none' };
    const record = sessions.get(cookie.value);
    if (record === undefined) return { status: 'dead' };
    // A changed trust configuration invalidates every existing session.
    if (record.trustConfigHash !== loaded.configHash) {
      sessions.invalidate(record.id);
      return { status: 'dead' };
    }
    return { status: 'active', record };
  }

  function guardSessionRead(reply: FastifyReply, lookup: SessionLookup): true | undefined {
    if (lookup.status === 'malformed') {
      return sendSafeError(
        reply,
        400,
        UI_ERROR.CLIENT_STATE_INVALID,
        'Repeated or malformed session cookie.',
        false,
      );
    }
    if (lookup.status === 'none') {
      return sendSafeError(reply, 401, UI_ERROR.REAUTH_REQUIRED, 'Sign-in required.', true);
    }
    if (lookup.status === 'dead') {
      return sendSafeError(reply, 401, UI_ERROR.SESSION_EXPIRED, 'Session expired.', true);
    }
    return undefined;
  }

  /** Session + Origin + Host + CSRF + Content-Type, in that rejection order. */
  function guardProtected(
    request: FastifyRequest,
    reply: FastifyReply,
    expectedContentType: string | undefined,
  ): { record: SessionRecord } | { handled: true } {
    const lookup = lookupSession(request);
    const failure = guardSessionRead(reply, lookup);
    if (failure) return { handled: true };
    if (lookup.status !== 'active') return { handled: true };
    const target = effectiveTarget(request);
    if (!originAllowed(config.publicOrigin, target.origin)) {
      return {
        handled: sendSafeError(
          reply,
          403,
          UI_ERROR.ORIGIN_REJECTED,
          'Request origin rejected.',
          false,
        ),
      };
    }
    if (!hostAllowed(config.allowedHosts, target.host)) {
      return {
        handled: sendSafeError(
          reply,
          403,
          UI_ERROR.ORIGIN_REJECTED,
          'Request host rejected.',
          false,
        ),
      };
    }
    const csrf = request.headers['x-csrf-token'];
    if (typeof csrf !== 'string' || !csrfMatches(lookup.record.csrfToken, csrf)) {
      return {
        handled: sendSafeError(reply, 403, UI_ERROR.CSRF_REJECTED, 'CSRF token rejected.', false),
      };
    }
    if (
      expectedContentType !== undefined &&
      request.headers['content-type'] !== undefined &&
      !contentTypeAllowed(request.headers['content-type'], expectedContentType)
    ) {
      return {
        handled: sendSafeError(
          reply,
          415,
          UI_ERROR.CLIENT_STATE_INVALID,
          'Unsupported content type.',
          false,
        ),
      };
    }
    return { record: lookup.record };
  }

  function sessionPayload(record: SessionRecord, extra: Record<string, unknown> = {}) {
    return {
      accessState: 'ALLOWED',
      businessActionsEnabled: true,
      sessionGeneration: record.generation,
      csrfToken: record.csrfToken,
      expiresAt: iso(record.absoluteExpiresAt),
      idleExpiresAt: iso(sessions.idleExpiresAt(record)),
      principal: record.principal,
      ...extra,
    };
  }

  function setLoginCookie(reply: FastifyReply, browserBindingId: string): void {
    appendSetCookie(reply, serializeCookie(LOGIN_COOKIE, browserBindingId, { maxAgeSeconds: 300 }));
  }

  function redirect(reply: FastifyReply, location: string): true {
    reply.status(302).header('location', location);
    reply.send();
    return true;
  }

  async function handleLogin(
    request: FastifyRequest,
    reply: FastifyReply,
    rawQuery: string,
  ): Promise<true> {
    if (!hostAllowed(config.allowedHosts, effectiveTarget(request).host)) {
      return sendSafeError(reply, 403, UI_ERROR.ORIGIN_REJECTED, 'Request host rejected.', false);
    }
    const parameters = new URLSearchParams(rawQuery);
    for (const key of parameters.keys()) {
      if (key !== 'returnTo' || parameters.getAll(key).length > 1) {
        return sendSafeError(
          reply,
          400,
          UI_ERROR.CLIENT_STATE_INVALID,
          'Unsupported login parameters.',
          false,
        );
      }
    }
    let returnTo: string;
    try {
      returnTo = resolveReturnTo(config, parameters.get('returnTo') ?? undefined);
    } catch {
      return sendSafeError(
        reply,
        400,
        UI_ERROR.CLIENT_STATE_INVALID,
        'Return route rejected.',
        false,
      );
    }
    const cookie = readSingleCookie(request.headers.cookie, LOGIN_COOKIE);
    if (cookie.status !== 'ok') {
      return sendSafeError(
        reply,
        400,
        UI_ERROR.CLIENT_STATE_INVALID,
        'Repeated or malformed sign-in cookie.',
        false,
      );
    }
    const browserBindingId = cookie.value ?? randomToken(32);
    let authorizationEndpoint: string;
    try {
      authorizationEndpoint = (await provider.metadata()).authorizationEndpoint;
    } catch {
      return sendSafeError(
        reply,
        503,
        UI_ERROR.SERVICE_NOT_CONFIGURED,
        'Sign-in service unavailable.',
        true,
      );
    }
    const codeVerifier = randomToken(48);
    const state = randomToken(32);
    const nonce = randomToken(32);
    try {
      transactions.issue({
        state,
        nonce,
        codeVerifier,
        codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
        browserBindingId,
        expectedIssuer: config.issuer,
        trustConfigHash: loaded.configHash,
        returnTo,
      });
    } catch {
      return sendSafeError(
        reply,
        503,
        UI_ERROR.SERVICE_NOT_CONFIGURED,
        'Sign-in capacity exhausted.',
        true,
      );
    }
    setLoginCookie(reply, browserBindingId);
    const authorizationUrl = new URL(authorizationEndpoint);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('response_mode', 'query');
    authorizationUrl.searchParams.set('scope', 'openid');
    authorizationUrl.searchParams.set('client_id', config.clientId);
    authorizationUrl.searchParams.set('redirect_uri', config.callbackUri);
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('nonce', nonce);
    authorizationUrl.searchParams.set(
      'code_challenge',
      createHash('sha256').update(codeVerifier).digest('base64url'),
    );
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    return redirect(reply, authorizationUrl.toString());
  }

  function safeReturnRedirect(returnTo: string, errorCode: string): string {
    const url = new URL(`${config.publicOrigin}${returnTo}`);
    url.searchParams.set('error', errorCode);
    return `${url.pathname}${url.search}`;
  }

  async function handleCallback(
    request: FastifyRequest,
    reply: FastifyReply,
    rawQuery: string,
  ): Promise<true> {
    if (!hostAllowed(config.allowedHosts, effectiveTarget(request).host)) {
      return sendSafeError(reply, 403, UI_ERROR.ORIGIN_REJECTED, 'Request host rejected.', false);
    }
    const rejected = (): true =>
      sendSafeError(reply, 400, UI_ERROR.REAUTH_REQUIRED, 'Sign-in response rejected.', false);
    let parsed;
    try {
      parsed = parseCallbackQuery(rawQuery);
    } catch {
      return rejected();
    }
    const cookie = readSingleCookie(request.headers.cookie, LOGIN_COOKIE);
    if (cookie.status !== 'ok' || cookie.value === undefined) return rejected();
    const transaction = transactions.peek(parsed.state);
    if (transaction === undefined) return rejected();
    if (
      transaction.browserBindingId !== cookie.value ||
      transaction.trustConfigHash !== loaded.configHash ||
      parsed.iss !== transaction.expectedIssuer ||
      parsed.iss !== config.issuer
    ) {
      return rejected();
    }
    const consumed = transactions.consume(parsed.state, cookie.value);
    if (consumed === undefined) return rejected();
    appendSetCookie(reply, clearCookie(LOGIN_COOKIE));
    if (parsed.kind === 'oidc-error') {
      // The IdP message, description and URI are discarded: never echoed, never
      // logged, never followed, and the browser only learns a fixed safe code.
      return redirect(reply, safeReturnRedirect(consumed.returnTo, UI_ERROR.REAUTH_REQUIRED));
    }

    try {
      const tokens = await provider.exchangeAuthorizationCode({
        code: parsed.code,
        codeVerifier: consumed.codeVerifier,
      });
      const now = context.now();
      const idToken = await verifyIdToken({
        token: tokens.idToken,
        config,
        keys: (kid) => provider.keyFor(kid),
        nonce: consumed.nonce,
        now,
      });
      const accessToken = await verifyAccessToken({
        token: tokens.accessToken,
        config,
        keys: (kid) => provider.keyFor(kid),
        now,
      });
      const identity = verifiedIdentity(idToken, accessToken);
      const sessionBinding = randomToken(SESSION_BINDING_BYTES);
      const bootstrap = await bootstrapCore({
        accessToken: tokens.accessToken,
        sessionBinding,
      });
      if (bootstrap === undefined) {
        return sendSafeError(
          reply,
          503,
          UI_ERROR.SERVICE_NOT_CONFIGURED,
          'Identity service unavailable.',
          true,
        );
      }
      if (bootstrap.status !== 200) {
        return sendCoreFailure(reply, bootstrap);
      }
      const principal = principalSummary(bootstrap.body);
      if (principal === undefined) {
        return sendSafeError(
          reply,
          503,
          UI_ERROR.SERVICE_NOT_CONFIGURED,
          'Identity service response invalid.',
          true,
        );
      }
      const refreshToken = tokens.refreshToken;
      const record = sessions.create({
        browserBindingId: cookie.value,
        sessionBinding,
        issuer: identity.issuer,
        subject: identity.subject,
        accessToken: tokens.accessToken,
        refreshToken,
        accessTokenExpiresAt: accessTokenExpiry(accessToken.claims.exp, now),
        csrfToken: issueCsrfToken(),
        principal,
        trustConfigHash: loaded.configHash,
      });
      if (record === undefined) {
        return sendSafeError(
          reply,
          503,
          UI_ERROR.SERVICE_NOT_CONFIGURED,
          'Session capacity exhausted.',
          true,
        );
      }
      appendSetCookie(
        reply,
        serializeCookie(SESSION_COOKIE, record.id, {
          maxAgeSeconds: Math.max(1, Math.floor((record.absoluteExpiresAt - now) / 1000)),
        }),
      );
      return redirect(reply, consumed.returnTo);
    } catch (error) {
      if (error instanceof OidcDependencyError) {
        return sendSafeError(
          reply,
          503,
          UI_ERROR.SERVICE_NOT_CONFIGURED,
          'Sign-in service unavailable.',
          true,
        );
      }
      if (error instanceof OidcRejectedError || error instanceof JwtRejectedError) {
        return sendSafeError(
          reply,
          401,
          UI_ERROR.REAUTH_REQUIRED,
          'Sign-in could not be completed.',
          false,
        );
      }
      throw error;
    }
  }

  async function bootstrapCore(input: {
    accessToken: string;
    sessionBinding: string;
  }): Promise<{ status: number; body: Record<string, unknown> | undefined } | undefined> {
    let response: Response;
    try {
      response = await context.fetchImpl(
        `${trimTrailingSlash(config.apiBaseUrl)}/workspace/session-bootstrap`,
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization: `Bearer ${input.accessToken}`,
            'x-workspace-session-binding': input.sessionBinding,
            'x-workspace-trust-config-hash': loaded.configHash,
          },
          body: '{}',
          signal: AbortSignal.timeout(config.httpTimeoutSeconds * 1000),
        },
      );
    } catch {
      return undefined;
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      return undefined;
    }
    if (text.length > 64 * 1024) return undefined;
    let body: Record<string, unknown> | undefined;
    try {
      const candidate: unknown = JSON.parse(text);
      body = isPlainObject(candidate) ? candidate : undefined;
    } catch {
      body = undefined;
    }
    return { status: response.status, body };
  }

  function sendCoreFailure(
    reply: FastifyReply,
    bootstrap: { status: number; body: Record<string, unknown> | undefined },
  ): true {
    const body = bootstrap.body ?? {};
    const code =
      typeof body.code === 'string' && body.code.length > 0
        ? body.code
        : bootstrap.status === 403
          ? CORE_ERROR.ACCESS_DENIED
          : CORE_ERROR.AUTHENTICATION_REQUIRED;
    const message =
      typeof body.message === 'string' && body.message.length > 0
        ? body.message
        : 'Request rejected.';
    const retryable = typeof body.retryable === 'boolean' ? body.retryable : false;
    const status = bootstrap.status === 200 ? 503 : bootstrap.status;
    reply.status(status).send(safeErrorBody(code, message, retryable, uuidV7()));
    return true;
  }

  function handleSession(request: FastifyRequest, reply: FastifyReply): true {
    const lookup = lookupSession(request);
    if (lookup.status === 'malformed') {
      return sendSafeError(
        reply,
        400,
        UI_ERROR.CLIENT_STATE_INVALID,
        'Repeated or malformed session cookie.',
        false,
      );
    }
    if (lookup.status === 'none') {
      reply.send({ accessState: 'REAUTH_REQUIRED', businessActionsEnabled: false });
      return true;
    }
    if (lookup.status === 'dead') {
      reply.send({ accessState: 'SESSION_EXPIRED', businessActionsEnabled: false });
      return true;
    }
    reply.send(sessionPayload(lookup.record));
    return true;
  }

  function handleBootstrap(request: FastifyRequest, reply: FastifyReply): true {
    const lookup = lookupSession(request);
    if (lookup.status === 'active') {
      reply.send(sessionPayload(lookup.record));
      return true;
    }
    reply.send({
      accessState: lookup.status === 'dead' ? 'SESSION_EXPIRED' : 'REAUTH_REQUIRED',
      businessActionsEnabled: false,
    });
    return true;
  }

  function handleActivity(request: FastifyRequest, reply: FastifyReply): true {
    const guarded = guardProtected(request, reply, JSON_CONTENT_TYPE);
    if ('handled' in guarded) return true;
    const extended = sessions.touch(guarded.record);
    reply.send(sessionPayload(guarded.record, { extended }));
    return true;
  }

  async function handleLogout(request: FastifyRequest, reply: FastifyReply): Promise<true> {
    const lookup = lookupSession(request);
    if (lookup.status === 'malformed') {
      return sendSafeError(
        reply,
        400,
        UI_ERROR.CLIENT_STATE_INVALID,
        'Repeated or malformed session cookie.',
        false,
      );
    }
    let record: SessionRecord | undefined;
    if (lookup.status === 'active') {
      const guarded = guardProtected(request, reply, JSON_CONTENT_TYPE);
      if ('handled' in guarded) return true;
      record = guarded.record;
    }
    if (record !== undefined) sessions.invalidate(record.id);
    appendSetCookie(reply, clearCookie(SESSION_COOKIE));
    appendSetCookie(reply, clearCookie(LOGIN_COOKIE));
    await revokeUpstream(record);
    reply.send({ accessState: 'REAUTH_REQUIRED', businessActionsEnabled: false });
    return true;
  }

  /** Best-effort upstream logout: a failure never restores the local session. */
  async function revokeUpstream(record: SessionRecord | undefined): Promise<void> {
    try {
      const metadata = await provider.metadata();
      const revocationEndpoint = metadata.revocationEndpoint;
      if (revocationEndpoint !== undefined && record?.refreshToken !== undefined) {
        await context.fetchImpl(revocationEndpoint, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: loaded.clientAuthSecret,
            token: record.refreshToken,
            token_type_hint: 'refresh_token',
          }).toString(),
          redirect: 'manual',
          signal: AbortSignal.timeout(config.httpTimeoutSeconds * 1000),
        });
        return;
      }
      if (metadata.endSessionEndpoint !== undefined) {
        const url = new URL(metadata.endSessionEndpoint);
        url.searchParams.set('client_id', config.clientId);
        url.searchParams.set('post_logout_redirect_uri', config.postLogoutRedirectUri);
        await context.fetchImpl(url.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(config.httpTimeoutSeconds * 1000),
        });
      }
    } catch {
      // Deliberately ignored: local invalidation already happened.
    }
  }

  async function handleOperation(
    request: FastifyRequest,
    reply: FastifyReply,
    path: string,
    method: string,
  ): Promise<boolean> {
    let parsed;
    try {
      parsed = parseOperationPath(path);
    } catch {
      return sendSafeError(
        reply,
        400,
        UI_ERROR.CLIENT_STATE_INVALID,
        'Operation path rejected.',
        false,
      );
    }
    if (parsed === undefined) return false;
    if (method !== 'POST') {
      return sendSafeError(reply, 405, UI_ERROR.CLIENT_STATE_INVALID, 'Method not allowed.', false);
    }
    try {
      assertNoOverrideHeaders(request.headers);
    } catch {
      return sendSafeError(
        reply,
        400,
        UI_ERROR.CLIENT_STATE_INVALID,
        'Caller-supplied identity or decision fields are not accepted.',
        false,
      );
    }
    const guarded = guardProtected(request, reply, JSON_CONTENT_TYPE);
    if ('handled' in guarded) return true;
    const body = await readJsonBody(request);
    if (body.status !== 'ok') {
      return sendSafeError(
        reply,
        httpStatusForBody(body),
        UI_ERROR.CLIENT_STATE_INVALID,
        'Request body rejected.',
        false,
      );
    }
    let correlationId: string;
    try {
      if (parsed.kind === 'queries') validateQueryProjection(body.value);
      else validateCommandProjection(body.value);
      correlationId =
        typeof body.value.correlationId === 'string' && body.value.correlationId.length > 0
          ? body.value.correlationId
          : uuidV7();
      if (body.value.type !== parsed.operation || body.value.version !== parsed.version) {
        throw new OperationRequestError('route and body mismatch');
      }
    } catch {
      return sendSafeError(
        reply,
        400,
        UI_ERROR.CLIENT_STATE_INVALID,
        'Operation request rejected.',
        false,
      );
    }
    if (parsed.kind === 'commands') {
      return sendSafeError(
        reply,
        503,
        CORE_ERROR.DEPENDENCY_UNAVAILABLE,
        'Command transport unavailable.',
        true,
      );
    }
    if (!operationRegistered(parsed)) {
      return sendSafeError(reply, 404, CORE_ERROR.NOT_FOUND, 'Operation not available.', false);
    }
    const fresh = await ensureFreshSession(guarded.record);
    if (fresh === undefined) {
      return sendSafeError(reply, 401, UI_ERROR.SESSION_EXPIRED, 'Session expired.', true);
    }
    let result;
    try {
      result = await forwardQuery({
        operation: parsed.operation,
        version: parsed.version,
        body: body.value,
        record: fresh,
        correlationId,
      });
    } catch {
      return sendSafeError(
        reply,
        503,
        CORE_ERROR.DEPENDENCY_UNAVAILABLE,
        'Upstream dependency unavailable.',
        true,
      );
    }
    reply.status(result.status);
    reply.header('content-type', 'application/json');
    reply.header('x-correlation-id', correlationId);
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(result.text);
    } catch {
      reply.send(result.text);
      return true;
    }
    if (isPlainObject(parsedBody)) {
      if (
        parsedBody.correlationId === undefined &&
        (parsedBody.status === 'ERROR' || typeof parsedBody.code === 'string')
      ) {
        parsedBody.correlationId = correlationId;
      }
      reply.send(parsedBody);
      return true;
    }
    reply.send(result.text);
    return true;
  }

  /**
   * Refreshes only when the access token is at or near expiry. A failed,
   * timed-out or invalid_grant refresh invalidates the session; a late result
   * cannot resurrect a logged-out session (the store rechecks the record).
   */
  async function ensureFreshSession(record: SessionRecord): Promise<SessionRecord | undefined> {
    const now = context.now();
    if (record.accessTokenExpiresAt - now > config.clockSkewSeconds * 1000) return record;
    const refreshToken = record.refreshToken;
    if (refreshToken === undefined) {
      sessions.invalidate(record.id);
      return undefined;
    }
    const outcome = await sessions.refresh(
      record,
      async (current) => {
        const tokens = await provider.refresh(current.refreshToken ?? refreshToken);
        const accessToken = await verifyAccessToken({
          token: tokens.accessToken,
          config,
          keys: (kid) => provider.keyFor(kid),
          now: context.now(),
        });
        if (
          accessToken.claims.iss !== current.issuer ||
          accessToken.claims.sub !== current.subject
        ) {
          throw new OidcRejectedError('refresh subject changed');
        }
        if (tokens.idToken !== undefined) {
          const idToken = await verifyIdToken({
            token: tokens.idToken,
            config,
            keys: (kid) => provider.keyFor(kid),
            now: context.now(),
            skipNonce: true,
          });
          const identity = verifiedIdentity(idToken, accessToken);
          if (identity.subject !== current.subject) {
            throw new OidcRejectedError('refresh subject changed');
          }
        }
        return {
          accessToken: tokens.accessToken,
          accessTokenExpiresAt: accessTokenExpiry(accessToken.claims.exp, context.now()),
          refreshToken: tokens.refreshToken,
        };
      },
      context.refreshWaitMs,
    );
    if (outcome !== 'REFRESHED') return undefined;
    return sessions.get(record.id);
  }

  async function forwardQuery(input: {
    operation: string;
    version: string;
    body: Record<string, unknown>;
    record: SessionRecord;
    correlationId: string;
  }): Promise<{ status: number; text: string }> {
    const url = `${trimTrailingSlash(config.apiBaseUrl)}/queries/${input.operation}/${input.version}`;
    const response = await context.fetchImpl(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${input.record.accessToken}`,
        'x-workspace-session-binding': input.record.sessionBinding,
        'x-workspace-trust-config-hash': loaded.configHash,
        'x-correlation-id': input.correlationId,
      },
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(config.httpTimeoutSeconds * 1000),
    });
    const text = await response.text();
    if (text.length > CORE_RESPONSE_LIMIT) throw new Error('core response too large');
    return { status: response.status, text };
  }

  function handleZip(
    request: FastifyRequest,
    reply: FastifyReply,
    path: string,
    method: string,
  ): boolean {
    const segments = path.split('/');
    if (
      segments.length !== 5 ||
      segments[1] !== 'bff' ||
      segments[2] !== 'customer-intakes' ||
      segments[4] !== 'zip' ||
      (segments[3] ?? '').length === 0
    ) {
      return false;
    }
    if (path.includes('%')) {
      return sendSafeError(
        reply,
        400,
        UI_ERROR.CLIENT_STATE_INVALID,
        'Intake path rejected.',
        false,
      );
    }
    if (method !== 'PUT') {
      return sendSafeError(reply, 405, UI_ERROR.CLIENT_STATE_INVALID, 'Method not allowed.', false);
    }
    const guarded = guardProtected(request, reply, ZIP_CONTENT_TYPE);
    if ('handled' in guarded) return true;
    // No owning registered ZIP transport exists yet: unknown, not a fake success.
    return sendSafeError(reply, 404, CORE_ERROR.NOT_FOUND, 'Intake upload not available.', false);
  }

  return async (request, reply) => {
    const { path, rawQuery } = splitUrl(request.url);
    const method = request.method.toUpperCase();
    if (path.startsWith('/bff/queries/') || path.startsWith('/bff/commands/')) {
      return handleOperation(request, reply, path, method);
    }
    if (path.startsWith('/bff/customer-intakes/')) {
      return handleZip(request, reply, path, method);
    }
    switch (path) {
      case '/bff/health':
        if (method !== 'GET') {
          return sendSafeError(
            reply,
            405,
            UI_ERROR.CLIENT_STATE_INVALID,
            'Method not allowed.',
            false,
          );
        }
        reply.header('content-type', 'application/json');
        reply.send({ status: 'ok', businessIntegration: 'CONFIGURED' });
        return true;
      case '/bff/bootstrap':
        if (method !== 'GET') {
          return sendSafeError(
            reply,
            405,
            UI_ERROR.CLIENT_STATE_INVALID,
            'Method not allowed.',
            false,
          );
        }
        return handleBootstrap(request, reply);
      case '/bff/session':
        if (method !== 'GET') {
          return sendSafeError(
            reply,
            405,
            UI_ERROR.CLIENT_STATE_INVALID,
            'Method not allowed.',
            false,
          );
        }
        return handleSession(request, reply);
      case '/bff/session/activity':
        if (method !== 'POST') {
          return sendSafeError(
            reply,
            405,
            UI_ERROR.CLIENT_STATE_INVALID,
            'Method not allowed.',
            false,
          );
        }
        return handleActivity(request, reply);
      case '/bff/auth/login':
        if (method !== 'GET') {
          return sendSafeError(
            reply,
            405,
            UI_ERROR.CLIENT_STATE_INVALID,
            'Method not allowed.',
            false,
          );
        }
        return handleLogin(request, reply, rawQuery);
      case '/bff/auth/callback':
        if (method !== 'GET') {
          return sendSafeError(
            reply,
            405,
            UI_ERROR.CLIENT_STATE_INVALID,
            'Method not allowed.',
            false,
          );
        }
        return handleCallback(request, reply, rawQuery);
      case '/bff/auth/logout':
        if (method !== 'POST') {
          return sendSafeError(
            reply,
            405,
            UI_ERROR.CLIENT_STATE_INVALID,
            'Method not allowed.',
            false,
          );
        }
        return handleLogout(request, reply);
      default:
        return false;
    }
  };
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function accessTokenExpiry(exp: unknown, now: number): number {
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : now;
}

/**
 * The frozen session-bootstrap wire shape: a flat safe summary whose
 * `principalRef` carries the Principal object id. Anything else — including an
 * invented `principal.principalId` field — fails closed with no session.
 */
function principalSummary(
  body: Record<string, unknown> | undefined,
): SessionPrincipalSummary | undefined {
  if (body === undefined) return undefined;
  const principalRef = body.principalRef;
  if (!isPlainObject(principalRef)) return undefined;
  const objectId = principalRef.objectId;
  if (typeof objectId !== 'string' || !isUuidV7(objectId)) return undefined;
  if (body.principalKind !== 'HUMAN') return undefined;
  if (body.status !== 'ACTIVE') return undefined;
  const displayName = body.displayName;
  if (typeof displayName !== 'string' || displayName.length === 0) return undefined;
  if (hasControlCharacters(displayName)) return undefined;
  return { principalId: objectId, principalKind: 'HUMAN', displayName };
}
