// IM-UI-01 (#258): the real Core workspace runtime assembled from the
// deployment environment. It loads and validates the closed trust document,
// opens the application-owned PostgreSQL pools, builds the IdentityPolicy
// repository over the deployment crypto ports, creates the Core access-token
// verifier and the workspace dispatch, and exposes the single
// `WorkspaceTransportRuntime` the HTTP surface consumes.
//
// Every missing or invalid value is a startup rejection carrying a fixed safe
// code: the process never starts the workspace entry with a partially-invented
// identity, and no secret, key or connection string is ever logged. The
// controller can be exercised without any of this by injecting a fake runtime.

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

import { Pool } from 'pg';
import type { Common } from '@zhiju/contracts';
import {
  IdentityPolicyRepository,
  WorkspaceHumanIdentityError,
  authenticationContextHash,
  createIdentityPolicyDatabase,
  resolveVerifiedHuman,
  type IdentityCryptoPorts,
  type IdentityTransactionContext,
  type VerifiedOidcContextInput,
} from '@zhiju/identity-policy';
import { createEnterpriseProjectDatabase } from '@zhiju/enterprise-project';
import { createTaskExecutionDatabase } from '@zhiju/task-execution';
import { newUuidV7, sha256CanonicalJson } from '@zhiju/shared-kernel';

import { createPreparationEnvironment } from './preparation-environment.js';
import { createAccessTokenVerifier } from './access-token.js';
import { CORE_ERROR_CODE, WorkspaceCoreError, type CoreErrorCode } from './errors.js';
import { peerAllowed } from './net.js';
import { loadCoreTrustConfigFromEnv, type WorkspaceCoreTrustConfig } from './trust-config.js';
import {
  createWorkspaceDispatch,
  type WorkspaceDispatch,
  type WorkspaceDispatchConfig,
} from './dispatch.js';
import type {
  WorkspaceHumanBootstrap,
  WorkspaceTransportRuntime,
  WorkspaceDispatchRequest,
  WorkspaceDispatchResponse,
  WorkspaceVerifiedAccess,
  WorkspaceZipUploadRequest,
} from './controller.js';

/** Fixed, secret-free code reported when the workspace entry cannot start. */
export const WORKSPACE_STARTUP_REJECTED = 'WORKSPACE_STARTUP_REJECTED';

/** The shared application database URL; per-role URLs override it. */
export const WORKSPACE_DATABASE_URL_ENV = 'ZHIJU_WORKSPACE_DATABASE_URL';
export const WORKSPACE_IDENTITY_DATABASE_URL_ENV = 'ZHIJU_WORKSPACE_IDENTITY_DATABASE_URL';
export const WORKSPACE_ENTERPRISE_DATABASE_URL_ENV = 'ZHIJU_WORKSPACE_ENTERPRISE_DATABASE_URL';
export const WORKSPACE_TASK_EXECUTION_DATABASE_URL_ENV =
  'ZHIJU_WORKSPACE_TASK_EXECUTION_DATABASE_URL';
export const WORKSPACE_DISCOVERY_DATABASE_URL_ENV = 'ZHIJU_WORKSPACE_DISCOVERY_DATABASE_URL';
export const WORKSPACE_IDENTITY_LOOKUP_KEY_ENV = 'ZHIJU_WORKSPACE_IDENTITY_LOOKUP_KEY';
export const WORKSPACE_IDENTITY_FIELD_KEY_ENV = 'ZHIJU_WORKSPACE_IDENTITY_FIELD_KEY';
export const WORKSPACE_BOARD_CURSOR_KEY_ENV = 'ZHIJU_WORKSPACE_BOARD_CURSOR_KEY';
export const WORKSPACE_BOARD_POLICY_REFS_ENV = 'ZHIJU_WORKSPACE_BOARD_POLICY_REFS';

const BOARD_CURSOR_KEY_ID = 1;

/**
 * Non-null uuid sentinels for the technical identity-bootstrap RLS context.
 * The bootstrap read establishes a valid context only so the owning transaction
 * can run while the verified Human is resolved; it is never a business scope.
 */
const TECHNICAL_PRINCIPAL_SENTINEL = '00000000-0000-7000-8000-000000000001';
const TECHNICAL_ENTERPRISE_SENTINEL = '00000000-0000-7000-8000-000000000000';
const TECHNICAL_CONTEXT_TTL_MS = 300_000;
const IDENTITY_BOOTSTRAP_PURPOSE = 'workspace.session.bootstrap';

export class WorkspaceStartupError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`workspace core startup rejected: ${code}`);
    this.name = 'WorkspaceStartupError';
    this.code = code;
  }
}

export interface WorkspaceCoreRuntime extends WorkspaceTransportRuntime {
  readonly trustConfig: WorkspaceCoreTrustConfig;
}

function requiredValue(env: NodeJS.ProcessEnv, name: string, code: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new WorkspaceStartupError(code);
  }
  return value;
}

/**
 * Decodes a deployment key: 64 hexadecimal characters or base64/base64url of at
 * least 32 bytes. A wrong encoding or a short key is a startup rejection.
 */
function decodeKey(raw: string, code: string): Buffer {
  const hex =
    /^[0-9a-fA-F]+$/u.test(raw) && raw.length % 2 === 0 ? Buffer.from(raw, 'hex') : undefined;
  const decoded = hex ?? Buffer.from(raw, 'base64');
  if (decoded.length < 32) {
    throw new WorkspaceStartupError(code);
  }
  return decoded;
}

/**
 * The deployment IdentityPolicy crypto ports. The keyed lookup is HMAC-SHA-256
 * over the normalized identifier with the deployment lookup key; field
 * encryption is AES-256-GCM with a random 96-bit IV whose wire form is
 * `iv || authTag || ciphertext`. Key material never leaves this process.
 */
function createIdentityCryptoPorts(lookupKey: Buffer, fieldKey: Buffer): IdentityCryptoPorts {
  if (fieldKey.length !== 32) {
    throw new WorkspaceStartupError('WORKSPACE_IDENTITY_FIELD_KEY_INVALID');
  }
  return {
    lookupHash: {
      computeKeyedLookupHash: (normalizedInput: string) => ({
        hash: createHmac('sha256', lookupKey).update(normalizedInput, 'utf8').digest(),
        algorithm: 'HMAC-SHA-256',
        keyVersion: 1,
      }),
    },
    fieldEncryption: {
      encryptField: (plainText: string) => {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', fieldKey, iv);
        const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
        return {
          ciphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]),
          algorithm: 'AES-256-GCM',
          keyVersion: 1,
        };
      },
      decryptField: (field) => {
        const iv = field.ciphertext.subarray(0, 12);
        const authTag = field.ciphertext.subarray(12, 28);
        const encrypted = field.ciphertext.subarray(28);
        const decipher = createDecipheriv('aes-256-gcm', fieldKey, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
      },
    },
  };
}

/**
 * The technical identity-bootstrap read context of one verified request. Like
 * the project self-discovery scan it is derived canonically from the verified
 * `authenticationContextHash`; it is never a business AuthorizationDecision,
 * never persisted and never authorizes a business operation.
 */
function technicalIdentityContext(
  context: VerifiedOidcContextInput,
  crypto: IdentityCryptoPorts,
  now: Date,
): IdentityTransactionContext {
  const { authenticationContextHash: contextHash } = authenticationContextHash(context, crypto);
  const decisionHash = Buffer.from(
    sha256CanonicalJson({
      authenticationContextHash: contextHash.toString('hex'),
      purpose: IDENTITY_BOOTSTRAP_PURPOSE,
    }),
    'hex',
  );
  return {
    kind: 'REQUEST',
    principalId: TECHNICAL_PRINCIPAL_SENTINEL,
    actorSnapshotId: newUuidV7(),
    authorizationDecisionId: newUuidV7(),
    authorizationDecisionHash: decisionHash,
    authorizationDecisionExpiresAt: new Date(now.getTime() + TECHNICAL_CONTEXT_TTL_MS),
    enterpriseId: TECHNICAL_ENTERPRISE_SENTINEL,
    allowedProjectIds: [],
    correlationId: newUuidV7(),
  };
}

/** Maps a verifier failure onto one frozen Core error code. */
function verifierErrorCode(code: string, status: number): CoreErrorCode {
  const known = Object.values(CORE_ERROR_CODE) as readonly string[];
  if (known.includes(code)) return code as CoreErrorCode;
  return status === 503
    ? CORE_ERROR_CODE.DEPENDENCY_UNAVAILABLE
    : CORE_ERROR_CODE.AUTHENTICATION_REQUIRED;
}

function openPool(url: string): Pool {
  return new Pool({ connectionString: url, max: 10 });
}

function isVersionedRef(value: unknown): value is Common.VersionedRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (
    !('kind' in value) ||
    !('objectType' in value) ||
    !('objectId' in value) ||
    !('versionId' in value) ||
    !('scope' in value) ||
    !('contentHash' in value)
  ) {
    return false;
  }
  return value.kind === 'VERSIONED';
}

/**
 * Parses the closed project → VersionedRef map. A malformed document is a
 * startup rejection; an unconfigured project simply returns `undefined`, so the
 * owning board entry fails closed with its existing DEPENDENCY_UNAVAILABLE.
 */
function parseBoardPolicyRefs(raw: string): ReadonlyMap<string, Common.VersionedRef> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new WorkspaceStartupError('WORKSPACE_BOARD_POLICY_REFS_INVALID');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new WorkspaceStartupError('WORKSPACE_BOARD_POLICY_REFS_INVALID');
  }
  const refs = new Map<string, Common.VersionedRef>();
  for (const [projectId, value] of Object.entries(parsed)) {
    if (!isVersionedRef(value)) {
      throw new WorkspaceStartupError('WORKSPACE_BOARD_POLICY_REFS_INVALID');
    }
    refs.set(projectId, value);
  }
  return refs;
}

/**
 * Builds the complete trusted workspace runtime, or throws
 * `WorkspaceStartupError` with a safe code. The returned pools are owned by the
 * returned runtime for the process lifetime.
 */
export function createWorkspaceCoreFromEnv(
  env: NodeJS.ProcessEnv,
  options: {
    markdown?: WorkspaceDispatchConfig['markdown'];
    preparation?: WorkspaceDispatchConfig['preparation'];
  } = {},
): WorkspaceCoreRuntime {
  const loaded = loadCoreTrustConfigFromEnv(env);
  if (!loaded.ok) {
    throw new WorkspaceStartupError(loaded.code);
  }
  const trustConfig = loaded.config;

  const databaseUrl = requiredValue(
    env,
    WORKSPACE_DATABASE_URL_ENV,
    'WORKSPACE_DATABASE_URL_MISSING',
  );
  // A single IdentityPolicy pool serves both the repository reads and the
  // self-discovery scan. The scan issues `SET LOCAL ROLE
  // identity_workspace_discovery_reader`, so the login of this pool MUST be a
  // member of that role with SET TRUE; a scan failure surfaces as
  // DEPENDENCY_UNAVAILABLE rather than as an empty directory.
  const identityUrl =
    env[WORKSPACE_IDENTITY_DATABASE_URL_ENV] ??
    env[WORKSPACE_DISCOVERY_DATABASE_URL_ENV] ??
    databaseUrl;
  const enterpriseUrl = env[WORKSPACE_ENTERPRISE_DATABASE_URL_ENV] ?? databaseUrl;
  const taskExecutionUrl = env[WORKSPACE_TASK_EXECUTION_DATABASE_URL_ENV] ?? databaseUrl;

  const lookupKey = decodeKey(
    requiredValue(env, WORKSPACE_IDENTITY_LOOKUP_KEY_ENV, 'WORKSPACE_IDENTITY_LOOKUP_KEY_MISSING'),
    'WORKSPACE_IDENTITY_LOOKUP_KEY_INVALID',
  );
  const fieldKey = decodeKey(
    requiredValue(env, WORKSPACE_IDENTITY_FIELD_KEY_ENV, 'WORKSPACE_IDENTITY_FIELD_KEY_MISSING'),
    'WORKSPACE_IDENTITY_FIELD_KEY_INVALID',
  );
  const cursorKey = decodeKey(
    requiredValue(env, WORKSPACE_BOARD_CURSOR_KEY_ENV, 'WORKSPACE_BOARD_CURSOR_KEY_MISSING'),
    'WORKSPACE_BOARD_CURSOR_KEY_INVALID',
  );
  const boardPolicyRefs = parseBoardPolicyRefs(
    requiredValue(env, WORKSPACE_BOARD_POLICY_REFS_ENV, 'WORKSPACE_BOARD_POLICY_REFS_MISSING'),
  );
  const crypto = createIdentityCryptoPorts(lookupKey, fieldKey);

  const identityPool = openPool(identityUrl);
  const enterprisePool = openPool(enterpriseUrl);
  const identityDb = createIdentityPolicyDatabase(identityPool);
  const enterpriseProjectDb = createEnterpriseProjectDatabase(enterprisePool);
  const taskExecutionDb = createTaskExecutionDatabase(openPool(taskExecutionUrl));
  const repo = new IdentityPolicyRepository(crypto);

  const capabilityCodes = trustConfig.capabilityCodes;

  const preparation =
    options.preparation ??
    createPreparationEnvironment({
      env,
      identityPool,
      enterprisePool,
      integrationPool: openPool(env.ZHIJU_WORKSPACE_INTEGRATION_DATABASE_URL ?? databaseUrl),
      crypto,
      identityResolutionDeps: (access) => ({
        db: identityDb,
        repo,
        crypto,
        context: technicalIdentityContext(access.context, crypto, new Date()),
      }),
    });
  const verifier = createAccessTokenVerifier({ trustConfig });
  const dispatch: WorkspaceDispatch = createWorkspaceDispatch({
    ...(preparation ? { preparation } : {}),
    ...(options.markdown ? { markdown: options.markdown } : {}),
    identity: { db: identityDb, repo, crypto },
    enterpriseProjectDb,
    taskExecutionDb,
    capabilityCodes,
    boardService: { principalId: trustConfig.boardService.principalId },
    boardPolicyRef: (projectId) => boardPolicyRefs.get(projectId),
    cursorKey: { keyId: BOARD_CURSOR_KEY_ID, secret: cursorKey },
  });

  return {
    trustConfig,
    trustConfigHash: trustConfig.trustConfigHash,
    isTrustedPeer: (remoteAddress) =>
      remoteAddress !== undefined && peerAllowed(trustConfig, remoteAddress),
    verifyAccessToken: async ({ authorization, sessionBinding }) => {
      const token = authorization?.slice('Bearer '.length) ?? '';
      const result = await verifier.verify(token, sessionBinding);
      if (!result.ok) {
        throw new WorkspaceCoreError(verifierErrorCode(result.code, result.status));
      }
      return { context: result.context, sessionBinding };
    },
    bootstrapHuman: async (access: WorkspaceVerifiedAccess): Promise<WorkspaceHumanBootstrap> => {
      const deps = {
        db: identityDb,
        repo,
        crypto,
        context: technicalIdentityContext(access.context, crypto, new Date()),
      };
      try {
        const resolution = await resolveVerifiedHuman(deps, access.context);
        return { principalRef: resolution.principalRef, displayName: resolution.displayName };
      } catch (error) {
        if (error instanceof WorkspaceHumanIdentityError) {
          throw new WorkspaceCoreError(
            error.code === 'IDENTITY_WORKSPACE_HUMAN_NOT_LINKED'
              ? CORE_ERROR_CODE.ACCESS_DENIED
              : CORE_ERROR_CODE.DEPENDENCY_UNAVAILABLE,
          );
        }
        throw new WorkspaceCoreError(CORE_ERROR_CODE.DEPENDENCY_UNAVAILABLE);
      }
    },
    streamMarkdown: (request) => dispatch.stream(request),
    ...(preparation
      ? { uploadZip: (request: WorkspaceZipUploadRequest) => dispatch.upload(request) }
      : {}),
    dispatch: async (request: WorkspaceDispatchRequest): Promise<WorkspaceDispatchResponse> =>
      dispatch.execute(request),
  };
}
