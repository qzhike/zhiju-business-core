import { URL } from 'node:url';

export const REALM = 'zhiju-mvp';
export const CLIENT_ID = 'mvp-bff';
export const API_AUDIENCE = 'zhiju-mvp-api';
export const issuerFor = (config) => `http://127.0.0.1:${config.ports.identity}/realms/${REALM}`;
export const webOrigin = (config) => `http://127.0.0.1:${config.ports.web}`;

export function buildRealm(config, secrets) {
  return {
    realm: REALM,
    enabled: true,
    sslRequired: 'none',
    registrationAllowed: false,
    accessTokenLifespan: 300,
    ssoSessionIdleTimeout: 1800,
    ssoSessionMaxLifespan: 28800,
    clientScopes: [
      {
        name: 'basic',
        protocol: 'openid-connect',
        protocolMappers: [
          {
            name: 'sub',
            protocol: 'openid-connect',
            protocolMapper: 'oidc-sub-mapper',
            config: { 'access.token.claim': 'true' },
          },
        ],
      },
      {
        name: 'mvp-api-audience',
        protocol: 'openid-connect',
        protocolMappers: [
          {
            name: 'mvp-api-audience',
            protocol: 'openid-connect',
            protocolMapper: 'oidc-audience-mapper',
            config: {
              'included.custom.audience': API_AUDIENCE,
              'access.token.claim': 'true',
              'id.token.claim': 'false',
            },
          },
        ],
      },
    ],
    clients: [
      {
        clientId: CLIENT_ID,
        enabled: true,
        publicClient: false,
        clientAuthenticatorType: 'client-secret',
        secret: secrets.clientSecret,
        protocol: 'openid-connect',
        standardFlowEnabled: true,
        directAccessGrantsEnabled: false,
        redirectUris: [`${webOrigin(config)}/bff/auth/callback`],
        webOrigins: [webOrigin(config)],
        defaultClientScopes: ['basic', 'mvp-api-audience'],
        attributes: { 'pkce.code.challenge.method': 'S256' },
      },
    ],
    users: [
      {
        id: secrets.subjectId,
        username: secrets.username,
        enabled: true,
        email: 'operator@mvp.example.test',
        emailVerified: true,
        firstName: 'MVP',
        lastName: 'Operator',
        credentials: [{ type: 'password', value: secrets.operatorPassword, temporary: false }],
      },
    ],
  };
}

/**
 * One closed trust document shared by the MVP BFF and Core. The BFF hash is the
 * SHA-256 of these exact serialized bytes; capability/board keys are part of
 * the shared transport document but are not MVP authorization facts.
 */
export function trustDocument(config, secrets) {
  const issuer = issuerFor(config);
  const origin = webOrigin(config);
  return {
    trustConfigVersion: 'mvp-trust-v1',
    publicOrigin: origin,
    allowedHosts: [`127.0.0.1:${config.ports.web}`, `127.0.0.1:${config.ports.bff}`],
    trustedProxyPeers: [],
    issuer,
    providerCode: 'keycloak',
    discoveryUrl: `${issuer}/.well-known/openid-configuration`,
    clientId: CLIENT_ID,
    clientAuthSecretRef: 'env:ZHIJU_MVP_CLIENT_SECRET',
    apiAudience: API_AUDIENCE,
    allowedAzp: CLIENT_ID,
    callbackUri: `${origin}/bff/auth/callback`,
    postLogoutRedirectUri: `${origin}/custody`,
    returnRoutePatterns: ['/custody', '/custody/projects/:projectRef', '/workbench'],
    oidcEndpointAllowlist: [
      `${issuer}/.well-known/openid-configuration`,
      ...['auth', 'token', 'certs', 'logout', 'revoke'].map(
        (path) => `${issuer}/protocol/openid-connect/${path}`,
      ),
    ],
    apiBaseUrl: `http://127.0.0.1:${config.ports.core}/api`,
    apiGatewayPeers: ['127.0.0.1', '::1'],
    idTokenAlgorithms: ['RS256'],
    accessTokenAlgorithms: ['RS256'],
    accessTokenMaxAgeSeconds: 300,
    clockSkewSeconds: 30,
    jwksTtlSeconds: 300,
    httpTimeoutSeconds: 10,
    maxSessions: 100,
    maxLoginTransactions: 200,
    maxTransactionsPerBrowser: 4,
    maxConcurrentUploads: 2,
    capabilityCodes: {
      workspaceProjectDiscoveryHumanV1: 'unused.mvp.discovery',
      projectBoardSliceReadHumanV1: 'unused.mvp.board',
      taskBoardReadHumanV1: 'unused.mvp.task',
      taskBoardSourceReadV1: 'unused.mvp.source',
      taskBoardHealthReadV1: 'unused.mvp.health',
      taskBoardPolicyReadV1: 'unused.mvp.policy',
    },
    boardService: { principalId: secrets.boardServiceId },
  };
}

export function baseEnvironment(source = process.env) {
  return Object.fromEntries(
    ['PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'DOCKER_HOST']
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );
}

export function databaseUrl(config, username, password, database) {
  const url = new URL(`postgresql://127.0.0.1:${config.ports.database}/${database}`);
  url.username = username;
  url.password = password;
  return url.toString();
}

export function applicationEnvironments(config, secrets, installation) {
  const trust = JSON.stringify(trustDocument(config, secrets));
  const shared = { ...baseEnvironment(), NODE_ENV: 'production' };
  return {
    core: {
      ...shared,
      ZHIJU_MVP_INSTANCE_ID: config.instanceId,
      ZHIJU_MVP_DATABASE_URL: databaseUrl(
        config,
        'mvp_app_login',
        secrets.runtimePassword,
        'zhiju_mvp',
      ),
      ZHIJU_MVP_STORE_ROOT: installation.storeRoot,
      ZHIJU_MVP_STORE_ID: installation.storeId,
      ZHIJU_MVP_STORE_IDENTITY: installation.storeIdentity,
      ZHIJU_MVP_CURSOR_KEY: secrets.cursorKey,
      ZHIJU_MVP_TRUST_CONFIG: trust,
      ZHIJU_MVP_CORE_HOST: '127.0.0.1',
      ZHIJU_MVP_CORE_PORT: String(config.ports.core),
    },
    bff: {
      ...shared,
      PORT: String(config.ports.bff),
      ZHIJU_WORKSPACE_TRUST_CONFIG: trust,
      ZHIJU_MVP_CLIENT_SECRET: secrets.clientSecret,
      ZHIJU_BFF_MVP_CORE_URL: `http://127.0.0.1:${config.ports.core}`,
    },
    web: {
      ...baseEnvironment(),
      NODE_ENV: 'production',
      PORT: String(config.ports.web),
      BFF_URL: `http://127.0.0.1:${config.ports.bff}`,
    },
  };
}
