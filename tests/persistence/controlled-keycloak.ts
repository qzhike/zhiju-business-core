// IM-UI-01 (#266): the controlled Keycloak fixture of the required acceptance
// journey.
//
// Issue #266 requires a real controlled Keycloak Authorization Code + PKCE
// journey, not a synthetic issuer. This module starts the pinned Keycloak image
// as a disposable container in dev mode with `--import-realm`, so the realm is
// *generated at test time*: the container port is ephemeral, and only a
// generated realm document can bind the loopback redirect URI, the BFF origin,
// the issuer that the Core trust loader requires verbatim and the client
// secret/password that exist only for this test.
//
// Nothing here is a production installation, a production credential or a
// production client: the realm, the confidential client, the audience client
// scope, the un-audienced second client, the one test user and the signing key
// are all created for this controlled test only, and the container is removed
// again. `quay.io` is unreachable from the build hosts, so the genuine
// Keycloak 26.7.0 image is taken from its Docker Hub mirror, pinned by digest.
//
// The realm imports a signing key whose private half this fixture generates, so
// the acceptance case can (a) prove that a token which passes every other gate
// but carries a substituted `iss` is rejected for the issuer alone, and (b)
// present a token signed by the key a *real* admin-API key rotation retires.

import { execFile } from 'node:child_process';
import { createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { SUBJECT_EXTERNAL_ID, reserveLoopbackPort } from './trusted-http-fixtures.js';

const execFileAsync = promisify(execFile);

/** Pinned controlled Keycloak image; `quay.io` is unreachable, so Docker Hub is used. */
export const CONTROLLED_KEYCLOAK_IMAGE =
  'keycloak/keycloak:26.7.0@sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13';
/** The tag half of the pinned reference, reported as provenance. */
export const CONTROLLED_KEYCLOAK_VERSION_TAG = '26.7.0';
export const CONTROLLED_REALM = 'zhiju-controlled';
export const CONTROLLED_USERNAME = 'trusted-human';
/** The second confidential client: no audience mapper, so its tokens carry no API audience. */
export const UNAUDIENCED_CLIENT_ID = 'workspace-other';
/** A sibling realm path that is deliberately *not* the configured issuer. */
export const FOREIGN_ISSUER_REALM = 'zhiju-foreign';
/**
 * Access-token lifespan of the controlled realm. It must not exceed the
 * deployment document's `accessTokenMaxAgeSeconds` (hard maximum 300).
 */
export const CONTROLLED_ACCESS_TOKEN_LIFESPAN_SECONDS = 300;

const CONTAINER_PORT = 8080;
const ADMIN_USERNAME = 'admin';
const ADMIN_CLIENT_ID = 'admin-cli';
const READINESS_TIMEOUT_MS = 180_000;
const READINESS_POLL_MS = 500;
/** Every N readiness polls, prove the container is still running. */
const CONTAINER_STATE_CHECK_EVERY = 10;
const KEY_PROVIDER_TYPE = 'org.keycloak.keys.KeyProvider';
const JWKS_POLL_TIMEOUT_MS = 60_000;
/** Bounded wait of every single request to the controlled container. */
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;
const LOG_TAIL_LINES = 40;

/** Containers this fixture created but has not yet removed. */
const liveContainers = new Set<string>();

export interface ControlledKeycloakEndpoints {
  readonly issuer: string;
  readonly discoveryUrl: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly endSessionEndpoint: string;
  readonly revocationEndpoint: string;
}

export interface ControlledKeycloak extends ControlledKeycloakEndpoints {
  readonly containerName: string;
  readonly image: string;
  /** The version string read back from the running container. */
  readonly version: string;
  readonly origin: string;
  readonly clientSecret: string;
  readonly unaudiencedClientSecret: string;
  readonly userPassword: string;
  /** The `kid` of the signing key this fixture imported into the realm. */
  readonly importedSigningKid: string;
  /** Current `kid`s of the realm's published signing keys. */
  readonly readSigningKids: () => Promise<readonly string[]>;
  /** A real password-grant access token of the controlled realm's test user. */
  readonly fetchUserAccessToken: () => Promise<string>;
  /** A real client-credentials access token of the client without the audience mapper. */
  readonly fetchUnaudiencedAccessToken: () => Promise<string>;
  /** Signs a compact RS256 JWS with the realm's imported key under a chosen `kid`. */
  readonly mintAccessToken: (input: {
    readonly kid: string;
    readonly claims: Record<string, unknown>;
  }) => string;
  /** Rotates the realm signing key through the Keycloak admin REST API. */
  readonly rotateSigningKey: () => Promise<{
    readonly retiredKid: string;
    readonly newKid: string;
  }>;
  readonly stop: () => Promise<void>;
}

async function docker(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('docker', [...args], { maxBuffer: MAX_BUFFER_BYTES });
  return stdout;
}

/** Captures diagnostics without turning a failed diagnostic into a test failure. */
async function dockerDiagnostics(args: readonly string[]): Promise<string> {
  return docker(args).catch(() => '');
}

/**
 * Removes every container this fixture created, including one whose startup
 * failed partway. Safe to call more than once and after a successful stop.
 */
export async function removeAllControlledKeycloakContainers(): Promise<void> {
  for (const containerName of [...liveContainers]) {
    liveContainers.delete(containerName);
    await dockerDiagnostics(['rm', '--force', containerName]);
  }
}

async function readJsonRecord(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`controlled Keycloak returned a non-JSON body (status ${response.status})`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`controlled Keycloak returned a non-object body (status ${response.status})`);
  }
  return parsed as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`controlled Keycloak response is missing ${key}`);
  }
  return value;
}

function basicScope(): Record<string, unknown> {
  return {
    name: 'basic',
    protocol: 'openid-connect',
    attributes: { 'include.in.token.scope': 'false', 'display.on.consent.screen': 'false' },
    protocolMappers: [
      {
        name: 'sub',
        protocol: 'openid-connect',
        protocolMapper: 'oidc-sub-mapper',
        consentRequired: false,
        config: { 'access.token.claim': 'true', 'introspection.token.claim': 'true' },
      },
    ],
  };
}

/**
 * The single dedicated client scope that carries the audience mapper, so an
 * access token of the audience client names the configured API audience while
 * the un-audienced client's does not.
 */
function audienceScope(): Record<string, unknown> {
  return {
    name: 'workspace-api-audience',
    protocol: 'openid-connect',
    attributes: { 'include.in.token.scope': 'false', 'display.on.consent.screen': 'false' },
    protocolMappers: [
      {
        name: 'workspace-api-audience',
        protocol: 'openid-connect',
        protocolMapper: 'oidc-audience-mapper',
        consentRequired: false,
        config: {
          'included.custom.audience': 'zhiju-api',
          'access.token.claim': 'true',
          'id.token.claim': 'false',
        },
      },
    ],
  };
}

function bffClient(input: {
  readonly redirectUri: string;
  readonly webOrigin: string;
  readonly clientSecret: string;
}): Record<string, unknown> {
  return {
    clientId: 'workspace-bff',
    enabled: true,
    publicClient: false,
    clientAuthenticatorType: 'client-secret',
    secret: input.clientSecret,
    protocol: 'openid-connect',
    standardFlowEnabled: true,
    // Direct access grants keep the *real* issuer/audience/refresh evidence
    // obtainable from the same realm without a second browser journey.
    directAccessGrantsEnabled: true,
    redirectUris: [input.redirectUri],
    webOrigins: [input.webOrigin],
    defaultClientScopes: ['basic', 'workspace-api-audience'],
    attributes: { 'pkce.code.challenge.method': 'S256' },
  };
}

function unAudiencedClient(clientSecret: string): Record<string, unknown> {
  return {
    clientId: UNAUDIENCED_CLIENT_ID,
    enabled: true,
    publicClient: false,
    clientAuthenticatorType: 'client-secret',
    secret: clientSecret,
    protocol: 'openid-connect',
    standardFlowEnabled: false,
    serviceAccountsEnabled: true,
  };
}

function testUser(userPassword: string): Record<string, unknown> {
  return {
    // The token `sub` is the Keycloak user id, so the realm user id *is* the
    // external subject the owning IdentityPolicy link is provisioned against.
    id: SUBJECT_EXTERNAL_ID,
    username: CONTROLLED_USERNAME,
    enabled: true,
    emailVerified: true,
    email: 'trusted-human@example.test',
    firstName: 'Trusted',
    lastName: 'Human',
    credentials: [{ type: 'password', value: userPassword, temporary: false }],
  };
}

function importedSigningKey(privateKeyPem: string): Record<string, unknown> {
  return {
    name: 'controlled-rsa',
    providerId: 'rsa',
    config: {
      priority: ['100'],
      enabled: ['true'],
      active: ['true'],
      algorithm: ['RS256'],
      privateKey: [privateKeyPem],
    },
  };
}

function buildRealmDocument(input: {
  readonly redirectUri: string;
  readonly webOrigin: string;
  readonly clientSecret: string;
  readonly unaudiencedClientSecret: string;
  readonly userPassword: string;
  readonly signingPrivateKeyPem: string;
}): Record<string, unknown> {
  return {
    realm: CONTROLLED_REALM,
    enabled: true,
    // Plain HTTP on loopback is the controlled environment, never a deployment.
    sslRequired: 'none',
    accessTokenLifespan: CONTROLLED_ACCESS_TOKEN_LIFESPAN_SECONDS,
    ssoSessionIdleTimeout: 1800,
    ssoSessionMaxLifespan: 36_000,
    registrationAllowed: false,
    loginWithEmailAllowed: true,
    verifyEmail: false,
    clientScopes: [basicScope(), audienceScope()],
    clients: [
      bffClient({
        redirectUri: input.redirectUri,
        webOrigin: input.webOrigin,
        clientSecret: input.clientSecret,
      }),
      unAudiencedClient(input.unaudiencedClientSecret),
    ],
    users: [testUser(input.userPassword)],
    components: { [KEY_PROVIDER_TYPE]: [importedSigningKey(input.signingPrivateKeyPem)] },
  };
}

function signCompactJws(input: {
  readonly privateKey: KeyObject;
  readonly kid: string;
  readonly claims: Record<string, unknown>;
}): string {
  const header = { alg: 'RS256', typ: 'JWT', kid: input.kid };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedClaims = Buffer.from(JSON.stringify(input.claims)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(input.privateKey, 'base64url');
  return `${signingInput}.${signature}`;
}

async function fetchToken(input: {
  readonly tokenEndpoint: string;
  readonly form: Record<string, string>;
  readonly description: string;
}): Promise<Record<string, unknown>> {
  const response = await fetch(input.tokenEndpoint, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(input.form).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${input.description} failed with status ${response.status}`);
  }
  return readJsonRecord(response);
}

async function fetchAccessToken(input: {
  readonly tokenEndpoint: string;
  readonly form: Record<string, string>;
  readonly description: string;
}): Promise<string> {
  const body = await fetchToken(input);
  return requireString(body, 'access_token');
}

async function readSigningKids(jwksUri: string): Promise<readonly string[]> {
  const response = await fetch(jwksUri, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`controlled Keycloak JWKS failed with ${response.status}`);
  const document = await readJsonRecord(response);
  const keys = document.keys;
  if (!Array.isArray(keys)) throw new Error('controlled Keycloak JWKS has no keys array');
  const kids: string[] = [];
  for (const entry of keys) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const kid = (entry as Record<string, unknown>).kid;
    if (typeof kid === 'string' && kid.length > 0) kids.push(kid);
  }
  if (kids.length === 0) throw new Error('controlled Keycloak JWKS published no usable key');
  return kids;
}

async function waitForSigningKid(
  jwksUri: string,
  select: (kids: readonly string[]) => string | undefined,
): Promise<string> {
  const deadline = Date.now() + JWKS_POLL_TIMEOUT_MS;
  for (;;) {
    const selected = select(await readSigningKids(jwksUri));
    if (selected !== undefined) return selected;
    if (Date.now() > deadline) {
      throw new Error(`controlled Keycloak JWKS did not reach the expected key set in time`);
    }
    await delay(READINESS_POLL_MS);
  }
}

function findImportedRsaComponentId(body: unknown): string {
  if (!Array.isArray(body)) {
    throw new Error('controlled Keycloak component list was not an array');
  }
  for (const entry of body) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (record.providerId !== 'rsa') continue;
    const id = record.id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  throw new Error('the imported RSA key component was not found');
}

interface AdminResponse {
  readonly status: number;
  readonly body: unknown;
}

async function adminRequest(input: {
  readonly origin: string;
  readonly token: string;
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  readonly jsonBody?: Record<string, unknown>;
}): Promise<AdminResponse> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${input.token}`,
  };
  if (input.jsonBody !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${input.origin}/admin${input.path}`, {
    method: input.method,
    headers,
    ...(input.jsonBody === undefined ? {} : { body: JSON.stringify(input.jsonBody) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (text.length === 0) return { status: response.status, body: undefined };
  const parsed: unknown = JSON.parse(text);
  return { status: response.status, body: parsed };
}

/**
 * Starts the pinned controlled Keycloak, waits (bounded) for the realm's
 * discovery document and returns the fixture handle. A container that cannot be
 * started is a hard failure with the container log, never a skipped test.
 */
export async function startControlledKeycloak(input: {
  readonly redirectUri: string;
  readonly webOrigin: string;
}): Promise<ControlledKeycloak> {
  const port = await reserveLoopbackPort();
  const origin = `http://127.0.0.1:${port}`;
  const issuer = `${origin}/realms/${CONTROLLED_REALM}`;
  const clientSecret = randomBytes(24).toString('base64url');
  const unaudiencedClientSecret = randomBytes(24).toString('base64url');
  const userPassword = randomBytes(18).toString('base64url');
  const adminPassword = randomBytes(18).toString('base64url');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const signingPrivateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const importDirectory = mkdtempSync(join(tmpdir(), 'zhiju-controlled-keycloak-'));
  // The Keycloak container runs as a non-root user that must be able to read
  // the mounted realm document.
  chmodSync(importDirectory, 0o755);
  writeFileSync(
    join(importDirectory, `${CONTROLLED_REALM}-realm.json`),
    JSON.stringify(
      buildRealmDocument({
        redirectUri: input.redirectUri,
        webOrigin: input.webOrigin,
        clientSecret,
        unaudiencedClientSecret,
        userPassword,
        signingPrivateKeyPem,
      }),
    ),
    { mode: 0o644 },
  );

  const containerName = `zhiju-controlled-keycloak-${randomBytes(6).toString('hex')}`;
  liveContainers.add(containerName);

  const removeContainer = async (): Promise<void> => {
    liveContainers.delete(containerName);
    await dockerDiagnostics(['rm', '--force', containerName]);
    rmSync(importDirectory, { recursive: true, force: true });
  };

  await docker([
    'run',
    '--detach',
    '--name',
    containerName,
    '--publish',
    `127.0.0.1:${port}:${CONTAINER_PORT}`,
    '--volume',
    `${importDirectory}:/opt/keycloak/data/import:ro`,
    '--env',
    `KC_BOOTSTRAP_ADMIN_USERNAME=${ADMIN_USERNAME}`,
    '--env',
    `KC_BOOTSTRAP_ADMIN_PASSWORD=${adminPassword}`,
    // Pins the frontend URL, so the realm issuer is exactly the configured
    // loopback origin plus the realm path — no trailing slash, no Host drift.
    '--env',
    `KC_HOSTNAME=${origin}`,
    CONTROLLED_KEYCLOAK_IMAGE,
    'start-dev',
    '--import-realm',
  ]).catch(async (error: unknown) => {
    await removeContainer();
    throw error;
  });

  let document: Record<string, unknown>;
  try {
    document = await waitForRealm({ containerName, issuer });
  } catch (error) {
    await removeContainer();
    throw error;
  }

  const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
  const endpoints: ControlledKeycloakEndpoints = {
    issuer,
    discoveryUrl,
    authorizationEndpoint: requireString(document, 'authorization_endpoint'),
    tokenEndpoint: requireString(document, 'token_endpoint'),
    jwksUri: requireString(document, 'jwks_uri'),
    endSessionEndpoint: requireString(document, 'end_session_endpoint'),
    revocationEndpoint: requireString(document, 'revocation_endpoint'),
  };
  const kidsAtStart = await readSigningKids(endpoints.jwksUri);
  const importedSigningKid = kidsAtStart[0];
  if (kidsAtStart.length !== 1 || importedSigningKid === undefined) {
    throw new Error(
      `the controlled realm published ${kidsAtStart.length} signing keys; ` +
        'the generated realm must publish exactly its imported key',
    );
  }

  const versionOutput = await dockerDiagnostics([
    'exec',
    containerName,
    '/opt/keycloak/bin/kc.sh',
    '--version',
  ]);
  const version = versionOutput.split('\n')[0]?.trim() ?? '';
  if (version.length === 0) {
    await removeContainer();
    throw new Error('the controlled Keycloak container reported no version string');
  }

  const adminAccessToken = async (): Promise<string> => {
    const body = await fetchToken({
      tokenEndpoint: `${origin}/realms/master/protocol/openid-connect/token`,
      form: {
        grant_type: 'password',
        client_id: ADMIN_CLIENT_ID,
        username: ADMIN_USERNAME,
        password: adminPassword,
      },
      description: 'controlled Keycloak admin login',
    });
    return requireString(body, 'access_token');
  };

  return {
    ...endpoints,
    containerName,
    image: CONTROLLED_KEYCLOAK_IMAGE,
    version,
    origin,
    clientSecret,
    unaudiencedClientSecret,
    userPassword,
    importedSigningKid,
    readSigningKids: () => readSigningKids(endpoints.jwksUri),
    fetchUserAccessToken: () =>
      fetchAccessToken({
        tokenEndpoint: endpoints.tokenEndpoint,
        form: {
          grant_type: 'password',
          client_id: 'workspace-bff',
          client_secret: clientSecret,
          username: CONTROLLED_USERNAME,
          password: userPassword,
          scope: 'openid',
        },
        description: 'controlled Keycloak password grant',
      }),
    fetchUnaudiencedAccessToken: () =>
      fetchAccessToken({
        tokenEndpoint: endpoints.tokenEndpoint,
        form: {
          grant_type: 'client_credentials',
          client_id: UNAUDIENCED_CLIENT_ID,
          client_secret: unaudiencedClientSecret,
        },
        description: 'controlled Keycloak un-audienced client credentials grant',
      }),
    mintAccessToken: ({ kid, claims }) =>
      signCompactJws({ privateKey, kid, claims: { ...claims } }),
    rotateSigningKey: async () => {
      const token = await adminAccessToken();
      const realm = await adminRequest({
        origin,
        token,
        method: 'GET',
        path: `/realms/${CONTROLLED_REALM}`,
      });
      if (realm.status !== 200 || typeof realm.body !== 'object' || realm.body === null) {
        throw new Error(`reading the controlled realm failed with status ${realm.status}`);
      }
      const realmId = requireString(realm.body as Record<string, unknown>, 'id');
      const retiredKid = importedSigningKid;
      const created = await adminRequest({
        origin,
        token,
        method: 'POST',
        path: `/realms/${CONTROLLED_REALM}/components`,
        jsonBody: {
          name: `controlled-rotated-rsa-${randomBytes(4).toString('hex')}`,
          providerId: 'rsa-generated',
          providerType: KEY_PROVIDER_TYPE,
          parentId: realmId,
          config: {
            priority: ['200'],
            enabled: ['true'],
            active: ['true'],
            algorithm: ['RS256'],
            keySize: ['2048'],
          },
        },
      });
      if (created.status !== 201) {
        throw new Error(`creating the rotated realm key failed with status ${created.status}`);
      }
      const newKid = await waitForSigningKid(endpoints.jwksUri, (kids) => {
        const candidates = kids.filter((kid) => kid !== retiredKid);
        return candidates.length === 1 ? candidates[0] : undefined;
      });
      const components = await adminRequest({
        origin,
        token,
        method: 'GET',
        path: `/realms/${CONTROLLED_REALM}/components?type=${encodeURIComponent(KEY_PROVIDER_TYPE)}`,
      });
      const componentId = findImportedRsaComponentId(components.body);
      const removed = await adminRequest({
        origin,
        token,
        method: 'DELETE',
        path: `/realms/${CONTROLLED_REALM}/components/${componentId}`,
      });
      if (removed.status !== 204) {
        throw new Error(`retiring the previous realm key failed with status ${removed.status}`);
      }
      await waitForSigningKid(endpoints.jwksUri, (kids) =>
        kids.length === 1 && kids[0] !== retiredKid ? kids[0] : undefined,
      );
      return { retiredKid, newKid };
    },
    stop: removeContainer,
  };
}

async function waitForRealm(input: {
  readonly containerName: string;
  readonly issuer: string;
}): Promise<Record<string, unknown>> {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  let polls = 0;
  for (;;) {
    polls += 1;
    try {
      const response = await fetch(`${input.issuer}/.well-known/openid-configuration`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const document = await readJsonRecord(response);
        if (document.issuer === input.issuer) return document;
      }
    } catch {
      // The container is not listening yet; the bounded wait below owns the failure.
    }
    if (Date.now() > deadline) throw new Error(await readinessFailure(input));
    if (polls % CONTAINER_STATE_CHECK_EVERY === 0) {
      const running = await dockerDiagnostics([
        'inspect',
        '--format',
        '{{.State.Running}}',
        input.containerName,
      ]);
      if (running.trim() !== 'true') throw new Error(await readinessFailure(input));
    }
    await delay(READINESS_POLL_MS);
  }
}

async function readinessFailure(input: {
  readonly containerName: string;
  readonly issuer: string;
}): Promise<string> {
  const logs = await dockerDiagnostics([
    'logs',
    '--tail',
    String(LOG_TAIL_LINES),
    input.containerName,
  ]);
  return (
    `the controlled Keycloak container ${input.containerName} did not serve ${input.issuer} ` +
    `within ${READINESS_TIMEOUT_MS}ms; container log tail:\n${logs}`
  );
}
