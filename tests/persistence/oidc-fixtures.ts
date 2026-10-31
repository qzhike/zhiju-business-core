// Shared transport-only fixtures; no legacy business database dependencies.
import { createServer } from 'node:net';

/** Fixed deployment identity shared by both synthetic processes. */
export const CLIENT_ID = 'workspace-bff';
export const API_AUDIENCE = 'zhiju-api';
export const AZP = 'workspace-bff';
export const CLIENT_SECRET = 'synthetic-client-secret';
export const CLIENT_SECRET_ENV = 'ZHIJU_TEST_CLIENT_SECRET';
export const PROVIDER_CODE = 'keycloak';
/** A realm-path issuer keeps the Core trust loader's issuer binding satisfied. */
export const ISSUER_REALM_PATH = '/realms/zhiju';
/** Distinctive external subject that must never surface in a response. */
export const SUBJECT_EXTERNAL_ID = 'external-subject-must-not-echo';

/** The six capability keys the Core deployment document must map. */
export const CAPABILITY_CODES = Object.freeze({
  workspaceProjectDiscoveryHumanV1: 'workspace.project.discovery.v1',
  projectBoardSliceReadHumanV1: 'project.board.slice.read.v1',
  taskBoardReadHumanV1: 'execution.task_board.read.v1',
  taskBoardSourceReadV1: 'execution.task_board.source.read.v1',
  taskBoardHealthReadV1: 'execution.task_board.health.read.v1',
  taskBoardPolicyReadV1: 'execution.task_board.policy.read.v1',
});

/**
 * Reserves a loopback port by opening and immediately closing a listener, so
 * the closed trust document can be built with the exact origin and upstream
 * before the real processes start.
 */
export async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  const started = Promise.withResolvers<undefined>();
  server.listen(0, '127.0.0.1', () => {
    started.resolve(undefined);
  });
  await started.promise;
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const closed = Promise.withResolvers<undefined>();
  server.close(() => {
    closed.resolve(undefined);
  });
  await closed.promise;
  return port;
}

export interface TrustDocumentInput {
  readonly bffPort: number;
  readonly corePort: number;
  readonly issuer: string;
  readonly discoveryUrl: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly jwksUrl: string;
  readonly endSessionUrl: string;
  readonly revocationUrl: string;
  readonly boardServicePrincipalId: string;
}

/**
 * The single closed deployment document both processes validate. The same
 * serialized bytes are handed to Core and to the BFF so their derived
 * trust-config hashes match exactly.
 */
export function buildTrustDocument(input: TrustDocumentInput): Record<string, unknown> {
  const publicOrigin = `http://127.0.0.1:${input.bffPort}`;
  return {
    trustConfigVersion: 'trusted-human-v1',
    publicOrigin,
    allowedHosts: [`127.0.0.1:${input.bffPort}`],
    trustedProxyPeers: [],
    issuer: input.issuer,
    providerCode: PROVIDER_CODE,
    discoveryUrl: input.discoveryUrl,
    clientId: CLIENT_ID,
    clientAuthSecretRef: `env:${CLIENT_SECRET_ENV}`,
    apiAudience: API_AUDIENCE,
    allowedAzp: AZP,
    callbackUri: `${publicOrigin}/bff/auth/callback`,
    postLogoutRedirectUri: `${publicOrigin}/workbench`,
    returnRoutePatterns: ['/workbench', '/projects/:projectRef', '/projects/:projectRef/*'],
    oidcEndpointAllowlist: [
      input.discoveryUrl,
      input.authorizeUrl,
      input.tokenUrl,
      input.jwksUrl,
      input.endSessionUrl,
      input.revocationUrl,
    ],
    apiBaseUrl: `http://127.0.0.1:${input.corePort}/api`,
    // A BFF on loopback may connect over IPv4 or IPv6; the closed peer list
    // contains both spellings so the trusted peer gate matches either socket.
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
    capabilityCodes: { ...CAPABILITY_CODES },
    boardService: { principalId: input.boardServicePrincipalId },
  };
}
