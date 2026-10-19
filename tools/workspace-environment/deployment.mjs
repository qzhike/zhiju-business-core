import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

export const REALM = 'zhiju-environment-b';
export const issuerFor = (config) => `http://127.0.0.1:${config.ports.identity}/realms/${REALM}`;

export function buildRealm(config, secrets) {
  const origin = `http://127.0.0.1:${config.ports.web}`;
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
        name: 'workspace-api-audience',
        protocol: 'openid-connect',
        protocolMappers: [
          {
            name: 'workspace-api-audience',
            protocol: 'openid-connect',
            protocolMapper: 'oidc-audience-mapper',
            config: {
              'included.custom.audience': 'zhiju-api',
              'access.token.claim': 'true',
              'id.token.claim': 'false',
            },
          },
        ],
      },
    ],
    clients: [
      {
        clientId: 'workspace-bff',
        enabled: true,
        publicClient: false,
        clientAuthenticatorType: 'client-secret',
        secret: secrets.clientSecret,
        protocol: 'openid-connect',
        standardFlowEnabled: true,
        directAccessGrantsEnabled: false,
        redirectUris: [`${origin}/bff/auth/callback`],
        webOrigins: [origin],
        defaultClientScopes: ['basic', 'workspace-api-audience'],
        attributes: { 'pkce.code.challenge.method': 'S256' },
      },
    ],
    users: [
      {
        id: secrets.subjectId,
        username: secrets.username,
        enabled: true,
        email: 'consultant@environment-b.example.test',
        emailVerified: true,
        firstName: 'Local',
        lastName: 'Consultant',
        credentials: [{ type: 'password', value: secrets.password, temporary: false }],
      },
    ],
  };
}

export function trustDocument(config, identities, preparation) {
  const publicOrigin = `http://127.0.0.1:${config.ports.web}`;
  const issuer = issuerFor(config);
  const preparationCapabilities = {};
  if (preparation !== undefined && preparation !== null) {
    for (const [key, operation] of [
      ['workspaceProjectDiscoveryHumanV1', 'project.workspace.discover'],
      ['projectBoardSliceReadHumanV1', 'project.get_project_board_slice'],
    ]) {
      const code = preparation.capabilityCodes?.[operation];
      if (
        typeof code !== 'string' ||
        !/^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/u.test(code) ||
        Object.values(preparationCapabilities).includes(code)
      )
        throw new Error('ENV_B_PREPARATION_CAPABILITY_INVALID');
      preparationCapabilities[key] = code;
    }
  }
  return {
    trustConfigVersion: 'trusted-human-v1',
    publicOrigin,
    allowedHosts: [`127.0.0.1:${config.ports.web}`, `127.0.0.1:${config.ports.bff}`],
    trustedProxyPeers: [],
    issuer,
    providerCode: 'keycloak',
    discoveryUrl: `${issuer}/.well-known/openid-configuration`,
    clientId: 'workspace-bff',
    clientAuthSecretRef: 'env:ZHIJU_ENV_B_CLIENT_SECRET',
    apiAudience: 'zhiju-api',
    allowedAzp: 'workspace-bff',
    callbackUri: `${publicOrigin}/bff/auth/callback`,
    postLogoutRedirectUri: `${publicOrigin}/workbench`,
    returnRoutePatterns: [
      '/workbench',
      '/projects/:projectRef',
      '/projects/:projectRef/*',
      '/preparations/:requestRef',
    ],
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
    maxSessions: 1000,
    maxLoginTransactions: 2000,
    maxTransactionsPerBrowser: 4,
    maxConcurrentUploads: 4,
    capabilityCodes: {
      workspaceProjectDiscoveryHumanV1: 'workspace.project.discovery.v1',
      projectBoardSliceReadHumanV1: 'project.board.slice.read.v1',
      taskBoardReadHumanV1: 'execution.task_board.read.v1',
      taskBoardSourceReadV1: 'execution.task_board.source.read.v1',
      taskBoardHealthReadV1: 'execution.task_board.health.read.v1',
      taskBoardPolicyReadV1: 'execution.task_board.policy.read.v1',
      ...preparationCapabilities,
    },
    boardService: { principalId: identities.boardServiceId },
  };
}

/** Do not pass provider credentials or Environment A settings to web services. */
export function baseEnvironment(source = process.env) {
  return Object.fromEntries(
    ['PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'DOCKER_HOST']
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );
}

export function databaseUrl(config, password, username = 'env_b_core', database = 'zhiju') {
  const url = new URL(`postgresql://127.0.0.1:${config.ports.database}/${database}`);
  url.username = username;
  url.password = password;
  return url.toString();
}

export function applicationEnvironments(config, secrets, identities, preparation) {
  const shared = {
    ...baseEnvironment(),
    NODE_ENV: 'production',
    ZHIJU_WORKSPACE_TRUST_CONFIG: JSON.stringify(trustDocument(config, identities, preparation)),
  };
  return {
    core: {
      ...shared,
      PORT: String(config.ports.core),
      ZHIJU_WORKSPACE_DATABASE_URL: databaseUrl(config, secrets.coreDatabasePassword),
      ZHIJU_WORKSPACE_IDENTITY_LOOKUP_KEY: secrets.lookupKey,
      ZHIJU_WORKSPACE_IDENTITY_FIELD_KEY: secrets.fieldKey,
      ZHIJU_WORKSPACE_BOARD_CURSOR_KEY: secrets.cursorKey,
      ZHIJU_WORKSPACE_BOARD_POLICY_REFS: '{}',
      ...(preparation
        ? {
            ZHIJU_WORKSPACE_DEPLOYMENT_MODE: 'MACOS_MANUAL_TEST',
            ZHIJU_PREPARATION_CONFIG: JSON.stringify(preparation),
            ZHIJU_PREPARATION_CURSOR_KEY: Buffer.from(secrets.cursorKey, 'hex').toString('base64'),
            ZHIJU_PREPARATION_TICKET_KEYS: JSON.stringify({
              'environment-b': Buffer.from(secrets.preparationTicketKey, 'hex').toString('base64'),
            }),
          }
        : {}),
    },
    bff: {
      ...shared,
      PORT: String(config.ports.bff),
      ZHIJU_ENV_B_CLIENT_SECRET: secrets.clientSecret,
    },
    web: {
      ...baseEnvironment(),
      NODE_ENV: 'production',
      PORT: String(config.ports.web),
      BFF_URL: `http://127.0.0.1:${config.ports.bff}`,
    },
  };
}
