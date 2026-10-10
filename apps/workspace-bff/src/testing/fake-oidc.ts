import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface KeyMaterial {
  kid: string;
  privateKey: KeyObject;
  publicJwk: Record<string, unknown>;
}

function generateKey(kid: string): KeyMaterial {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  return { kid, privateKey, publicJwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } };
}

const KEYRING: Record<string, KeyMaterial> = {
  'kid-1': generateKey('kid-1'),
  'kid-2': generateKey('kid-2'),
};

function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

function signJwt(
  key: KeyMaterial,
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
): string {
  const encodedHeader = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: key.kid, ...header }),
  ).toString('base64url');
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(key.privateKey, 'base64url');
  return `${signingInput}.${signature}`;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(text);
}

export interface FakeTokenRequest {
  grantType: string;
  form: Record<string, string>;
}

export interface TokenTemplate {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
}

/**
 * Deterministic synthetic OIDC provider: real RSA keys, real discovery/JWKS/
 * authorization/token endpoints over loopback HTTP, with per-test overrides for
 * negative claim and endpoint behaviour.
 */
export class FakeOidcProvider {
  baseUrl = '';
  issuer = '';
  jwksKids: string[] = ['kid-1'];
  jwksRequests = 0;
  tokenRequests: FakeTokenRequest[] = [];
  revocationRequests = 0;
  authorizeError = false;
  codeChallengeOverride: string | undefined;
  tokenDelayMs = 0;
  tokenStatusOverride: number | undefined;
  tokenBodyOverride: unknown;
  refreshStatusOverride: number | undefined;
  refreshBodyOverride: unknown;
  omitRefreshIdToken = false;
  idTokenTemplate: TokenTemplate = { header: {}, claims: {} };
  accessTokenTemplate: TokenTemplate = { header: {}, claims: {} };
  refreshIdTokenTemplate: TokenTemplate = { header: {}, claims: {} };
  lastRefreshToken: string | undefined;

  private readonly codes = new Map<
    string,
    { challenge: string; nonce: string; redirectUri: string; state: string }
  >();
  private readonly refreshTokens = new Set<string>();
  private server: ReturnType<typeof createServer> | undefined;
  private resolveTokenCompletion: ((value?: undefined) => void) | undefined;

  /** Resolves when the next token request has been fully answered. */
  nextTokenCompletion(): Promise<void> {
    const resolvers = Promise.withResolvers<undefined>();
    this.resolveTokenCompletion = resolvers.resolve;
    return resolvers.promise;
  }

  constructor(
    private readonly options: {
      clock: () => number;
      clientId: string;
      apiAudience: string;
      azp: string;
      sub?: string;
    },
  ) {}

  get sub(): string {
    return this.options.sub ?? 'human-1';
  }

  private nowSeconds(): number {
    return Math.floor(this.options.clock() / 1000);
  }

  async start(): Promise<void> {
    const server = createServer((request, response) => {
      this.handle(request, response).catch(() => {
        if (!response.headersSent) sendJson(response, 500, { error: 'server_error' });
      });
    });
    this.server = server;
    const started = Promise.withResolvers<undefined>();
    server.listen(0, '127.0.0.1', () => {
      started.resolve(undefined);
    });
    await started.promise;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    this.baseUrl = `http://127.0.0.1:${port}`;
    // A realm-shaped issuer, matching the exact-string comparison both the BFF
    // and Core apply to the deployment document.
    this.issuer = `${this.baseUrl}/realms/synthetic`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server === undefined) return;
    const closed = Promise.withResolvers<undefined>();
    server.close(() => {
      closed.resolve(undefined);
    });
    await closed.promise;
  }

  url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  discoveryDocument(): Record<string, unknown> {
    return {
      issuer: this.issuer,
      authorization_endpoint: this.url('/authorize'),
      token_endpoint: this.url('/token'),
      jwks_uri: this.url('/jwks'),
      end_session_endpoint: this.url('/logout'),
      revocation_endpoint: this.url('/revoke'),
      authorization_response_iss_parameter_supported: true,
    };
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const [path, rawQuery] = (request.url ?? '/').split('?') as [string, string];
    if (path === '/.well-known/openid-configuration') {
      sendJson(response, 200, this.discoveryDocument());
      return;
    }
    if (path === '/jwks') {
      this.jwksRequests += 1;
      sendJson(response, 200, { keys: this.jwksKids.map((kid) => KEYRING[kid]?.publicJwk) });
      return;
    }
    if (path === '/authorize') {
      this.authorize(new URLSearchParams(rawQuery), response);
      return;
    }
    if (path === '/token') {
      try {
        await this.token(request, response);
      } finally {
        const resolve = this.resolveTokenCompletion;
        this.resolveTokenCompletion = undefined;
        resolve?.();
      }
      return;
    }
    if (path === '/revoke' || path === '/logout') {
      this.revocationRequests += 1;
      sendJson(response, 200, {});
      return;
    }
    sendJson(response, 404, { error: 'not_found' });
  }

  private authorize(parameters: URLSearchParams, response: ServerResponse): void {
    const redirectUri = parameters.get('redirect_uri') ?? '';
    const state = parameters.get('state') ?? '';
    if (this.authorizeError) {
      const redirect = new URL(redirectUri);
      redirect.searchParams.set('error', 'access_denied');
      redirect.searchParams.set('error_description', 'user denied access');
      redirect.searchParams.set('error_uri', 'https://idp.example/errors/access_denied');
      redirect.searchParams.set('state', state);
      redirect.searchParams.set('iss', this.issuer);
      response.writeHead(302, { location: redirect.toString() });
      response.end();
      return;
    }
    if (
      parameters.get('response_type') !== 'code' ||
      parameters.get('code_challenge_method') !== 'S256'
    ) {
      sendJson(response, 400, { error: 'invalid_request' });
      return;
    }
    const code = randomToken(24);
    this.codes.set(code, {
      challenge: this.codeChallengeOverride ?? parameters.get('code_challenge') ?? '',
      nonce: parameters.get('nonce') ?? '',
      redirectUri,
      state,
    });
    const redirect = new URL(redirectUri);
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', state);
    redirect.searchParams.set('iss', this.issuer);
    redirect.searchParams.set('session_state', randomToken(12));
    response.writeHead(302, { location: redirect.toString() });
    response.end();
  }

  private tokenResource(template: TokenTemplate): KeyMaterial {
    const kid = template.header.kid;
    const fallback = KEYRING['kid-1'];
    if (fallback === undefined) throw new Error('synthetic keyring is empty');
    if (typeof kid !== 'string') return fallback;
    return KEYRING[kid] ?? fallback;
  }

  private async token(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const form = new URLSearchParams(await readBody(request));
    const record: Record<string, string> = {};
    for (const [key, value] of form) record[key] = value;
    const grantType = form.get('grant_type') ?? '';
    this.tokenRequests.push({ grantType, form: record });
    if (this.tokenDelayMs > 0) {
      const delay = Promise.withResolvers<undefined>();
      setTimeout(() => {
        delay.resolve(undefined);
      }, this.tokenDelayMs);
      await delay.promise;
    }
    const statusOverride =
      grantType === 'refresh_token' ? this.refreshStatusOverride : this.tokenStatusOverride;
    const bodyOverride =
      grantType === 'refresh_token' ? this.refreshBodyOverride : this.tokenBodyOverride;
    if (statusOverride !== undefined) {
      sendJson(response, statusOverride, bodyOverride ?? { error: 'invalid_grant' });
      return;
    }
    if (grantType === 'authorization_code') {
      const code = form.get('code') ?? '';
      const entry = this.codes.get(code);
      if (entry === undefined) {
        sendJson(response, 400, { error: 'invalid_grant' });
        return;
      }
      this.codes.delete(code);
      const verifier = form.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (challenge !== entry.challenge) {
        sendJson(response, 400, { error: 'invalid_grant' });
        return;
      }
      sendJson(
        response,
        200,
        this.issueTokens(this.idTokenTemplate, this.accessTokenTemplate, entry.nonce),
      );
      return;
    }
    if (grantType === 'refresh_token') {
      const refreshToken = form.get('refresh_token') ?? '';
      if (!this.refreshTokens.has(refreshToken)) {
        sendJson(response, 400, { error: 'invalid_grant' });
        return;
      }
      const body = this.issueTokens(
        this.refreshIdTokenTemplate,
        this.accessTokenTemplate,
        undefined,
        this.omitRefreshIdToken,
      );
      sendJson(response, 200, body);
      return;
    }
    sendJson(response, 400, { error: 'unsupported_grant_type' });
  }

  private issueTokens(
    idTemplate: TokenTemplate,
    accessTemplate: TokenTemplate,
    nonce: string | undefined,
    omitIdToken = false,
  ): Record<string, unknown> {
    const issuedAt = this.nowSeconds();
    const idClaims: Record<string, unknown> = {
      iss: this.issuer,
      sub: this.sub,
      aud: this.options.clientId,
      azp: this.options.azp,
      iat: issuedAt,
      exp: issuedAt + 300,
      ...(nonce === undefined ? {} : { nonce }),
      ...idTemplate.claims,
    };
    const accessClaims: Record<string, unknown> = {
      iss: this.issuer,
      sub: this.sub,
      aud: this.options.apiAudience,
      azp: this.options.azp,
      typ: 'Bearer',
      iat: issuedAt,
      nbf: issuedAt,
      exp: issuedAt + 300,
      ...accessTemplate.claims,
    };
    const refreshToken = randomToken(24);
    this.refreshTokens.add(refreshToken);
    this.lastRefreshToken = refreshToken;
    return {
      token_type: 'Bearer',
      access_token: signJwt(
        this.tokenResource(accessTemplate),
        accessTemplate.header,
        accessClaims,
      ),
      ...(omitIdToken
        ? {}
        : { id_token: signJwt(this.tokenResource(idTemplate), idTemplate.header, idClaims) }),
      refresh_token: refreshToken,
    };
  }
}
