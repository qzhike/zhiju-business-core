// IM-UI-01 (#266): shared fixtures for the real-process trusted-Human HTTP
// acceptance case. Everything here provisions *owning-module* rows through the
// owning repositories (IdentityPolicy) or as the accepted SQL fixture of
// EnterpriseProject/Projection rows (like `tests/persistence/query-projection.test.ts`),
// plus the closed deployment trust document the Core and the BFF must share
// byte-for-byte. Nothing here stubs a production surface.

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

import pg from 'pg';
import {
  IdentityPolicyRepository,
  createIdentityPolicyDatabase,
  withIdentityTransaction,
  type IdentityCryptoPorts,
  type IdentityTransactionContext,
  type ScopedAssignmentInsert,
} from '@zhiju/identity-policy';
import {
  calculateProjectBoardSnapshotHash,
  createEnterpriseProjectDatabase,
  rebuildProjectBoardProjection,
  type EnterpriseProjectTransactionContext,
  type ProjectBoardProjectionItemInput,
  type ProjectBoardSnapshotExport,
} from '@zhiju/enterprise-project';
import { newUuidV7 } from '@zhiju/shared-kernel';
import type { Common } from '@zhiju/contracts';

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

const DISCOVERY_ACTION = 'project.workspace.discover.v1';
const BOARD_SLICE_ACTION = 'project.get_project_board_slice.v1';
const TASK_BOARD_READ_ACTION = 'execution.task_board.read.v1';
const TASK_BOARD_SOURCE_READ_ACTION = 'execution.task_board.source.read.v1';
const OPERATOR_ID = '018f2a00-0000-7000-8000-0000000000aa';

/** The owning IdentityPolicy insert shape of one capability grant. */
interface CapabilityGrantInsert extends ScopedAssignmentInsert {
  readonly resourceSelectors: { selectorType: string; objectType: string }[];
  readonly actions: string[];
  readonly grantPolicySnapshotId: string;
  readonly grantPolicySnapshotHash: Buffer;
}

/** Real keyed-lookup and field-encryption ports with the deployment test keys. */
export function createFixtureCrypto(lookupKey: Buffer, fieldKey: Buffer): IdentityCryptoPorts {
  return {
    lookupHash: {
      computeKeyedLookupHash(normalizedInput: string) {
        return {
          hash: createHmac('sha256', lookupKey).update(normalizedInput).digest(),
          algorithm: 'HMAC-SHA-256',
          keyVersion: 1,
        };
      },
    },
    fieldEncryption: {
      encryptField(plainText: string) {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', fieldKey, iv);
        const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
        return {
          ciphertext: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]),
          algorithm: 'AES-256-GCM',
          keyVersion: 1,
        };
      },
      decryptField(field) {
        const iv = field.ciphertext.subarray(0, 12);
        const tag = field.ciphertext.subarray(12, 28);
        const body = field.ciphertext.subarray(28);
        const decipher = createDecipheriv('aes-256-gcm', fieldKey, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
      },
    },
  };
}

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

export interface ProvisionedWorkspace {
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly principalId: string;
  readonly servicePrincipalId: string;
  readonly enterpriseDisplayName: string;
  readonly projectTitle: string;
  readonly projectDisplayCode: string;
  readonly boardItemKey: string;
  readonly close: () => Promise<void>;
}

/**
 * Inserts the deterministic owner fixtures: one Enterprise + one Project with
 * its readable Projection, one linked ACTIVE HUMAN principal holding the
 * discovery, Project-Board-slice and Task-Board-read PROJECT grants, and the
 * fixed SERVICE board principal holding the Task-Board source-read grant.
 */
export async function provisionTrustedWorkspace(input: {
  readonly databaseUrl: string;
  readonly lookupKey: Buffer;
  readonly fieldKey: Buffer;
  readonly issuer: string;
}): Promise<ProvisionedWorkspace> {
  const { databaseUrl } = input;
  const crypto = createFixtureCrypto(input.lookupKey, input.fieldKey);
  const admin = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  const identityPool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  const enterprisePool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  const identityDb = createIdentityPolicyDatabase(identityPool);
  const enterpriseProjectDb = createEnterpriseProjectDatabase(enterprisePool);
  const repo = new IdentityPolicyRepository(crypto);

  const enterpriseId = newUuidV7();
  const projectId = newUuidV7();
  const principalId = newUuidV7();
  const servicePrincipalId = newUuidV7();
  const enterpriseDisplayName = 'Example Enterprise';
  const projectTitle = 'Pilot Project';
  const projectDisplayCode = 'PRJ-0001';
  const boardItemKey = 'item-1';

  const contextFor = (
    principal: string,
    allowedProjectIds: readonly string[],
  ): IdentityTransactionContext => ({
    kind: 'REQUEST',
    principalId: principal,
    actorSnapshotId: newUuidV7(),
    authorizationDecisionId: newUuidV7(),
    authorizationDecisionHash: randomBytes(32),
    authorizationDecisionExpiresAt: new Date(Date.now() + 300_000),
    enterpriseId,
    allowedProjectIds: [...allowedProjectIds],
    correlationId: newUuidV7(),
  });

  try {
    // EnterpriseProject owning rows, exactly as the accepted SQL fixture does.
    await admin.query('BEGIN');
    try {
      await admin.query(
        `INSERT INTO enterprise_project.enterprise
           (enterprise_id, display_code, display_name, status,
            created_by_principal_id, created_by_actor_snapshot_id)
         VALUES ($1, $2, $3, 'ACTIVE', $4, $5)`,
        [
          enterpriseId,
          `ENT-${enterpriseId.slice(-8)}`,
          enterpriseDisplayName,
          OPERATOR_ID,
          newUuidV7(),
        ],
      );
      await admin.query(
        `INSERT INTO enterprise_project.project
           (project_id, enterprise_id, display_code, title, objective,
            member_policy_ref, member_policy_version_id, member_policy_payload_hash,
            created_by_principal_id, created_by_actor_snapshot_id, last_command_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
        [
          projectId,
          enterpriseId,
          projectDisplayCode,
          projectTitle,
          'Exercise the trusted Human workspace HTTP journey.',
          JSON.stringify({
            kind: 'VERSIONED',
            objectType: 'Policy',
            objectId: newUuidV7(),
            versionId: newUuidV7(),
            scope: { enterpriseId },
          }),
          newUuidV7(),
          Buffer.alloc(32, 0xb5),
          OPERATOR_ID,
          newUuidV7(),
          newUuidV7(),
        ],
      );
      await admin.query('COMMIT');
    } catch (error) {
      await admin.query('ROLLBACK').catch(() => undefined);
      throw error;
    }

    const policySnapshotId = newUuidV7();
    let policySnapshotHash: Buffer = Buffer.alloc(0);
    await withIdentityTransaction(identityDb, contextFor(OPERATOR_ID, []), async (trx) => {
      await repo.insertPrincipal(trx, {
        id: principalId,
        principalKind: 'HUMAN',
        displayName: 'Trusted Human',
        createdByPrincipalId: OPERATOR_ID,
        createdByActorSnapshotId: newUuidV7(),
      });
      await repo.insertPrincipal(trx, {
        id: servicePrincipalId,
        principalKind: 'SERVICE',
        displayName: 'Board Service',
        createdByPrincipalId: OPERATOR_ID,
        createdByActorSnapshotId: newUuidV7(),
      });
      await repo.insertPolicySnapshot(trx, {
        policySnapshotId,
        policySetVersion: `wi266-http-${process.pid}-${Date.now()}`,
        policySchemaRefs: [],
        effectiveFrom: new Date(Date.now() - 300_000),
        contractVersion: '1.0',
        schemaRegistryVersion: 'im02-static-v1',
        policyDocument: { note: 'issue 266 trusted HTTP fixture' },
        createdByPrincipalId: OPERATOR_ID,
        actorSnapshotId: newUuidV7(),
        sourceCommandId: newUuidV7(),
        dataClassification: 'INTERNAL',
      });
      await repo.insertExternalIdentityLink(trx, {
        id: newUuidV7(),
        providerCode: PROVIDER_CODE,
        // The Core verifier binds `accountExternalId` to the verified issuer.
        accountExternalId: input.issuer,
        subjectExternalId: SUBJECT_EXTERNAL_ID,
        principalId,
        verifiedAt: new Date(Date.now() - 300_000),
        verificationMethod: 'wi266-synthetic-oidc',
        evidenceRefs: {},
        createdByPrincipalId: OPERATOR_ID,
        createdByActorSnapshotId: newUuidV7(),
      });
    });
    const snapshot = await withIdentityTransaction(identityDb, contextFor(OPERATOR_ID, []), (trx) =>
      trx
        .selectFrom('identity_policy.policy_snapshot')
        .selectAll()
        .where('policy_snapshot_id', '=', policySnapshotId)
        .executeTakeFirstOrThrow(),
    );
    policySnapshotHash = snapshot.payload_hash;

    const grant = (
      id: string,
      principal: string,
      code: string,
      action: string,
    ): CapabilityGrantInsert => ({
      id,
      principalId: principal,
      code,
      scopeKind: 'PROJECT',
      enterpriseId,
      projectId,
      validFrom: new Date(Date.now() - 300_000),
      justification: 'issue 266 trusted HTTP fixture',
      createdByPrincipalId: OPERATOR_ID,
      createdByActorSnapshotId: newUuidV7(),
      resourceSelectors: [{ selectorType: 'TARGET_TYPE', objectType: 'project.project' }],
      actions: [action],
      grantPolicySnapshotId: policySnapshotId,
      grantPolicySnapshotHash: policySnapshotHash,
    });
    await withIdentityTransaction(identityDb, contextFor(OPERATOR_ID, [projectId]), async (trx) => {
      await repo.insertCapabilityGrant(
        trx,
        grant(
          newUuidV7(),
          principalId,
          CAPABILITY_CODES.workspaceProjectDiscoveryHumanV1,
          DISCOVERY_ACTION,
        ),
      );
      await repo.insertCapabilityGrant(
        trx,
        grant(
          newUuidV7(),
          principalId,
          CAPABILITY_CODES.projectBoardSliceReadHumanV1,
          BOARD_SLICE_ACTION,
        ),
      );
      await repo.insertCapabilityGrant(
        trx,
        grant(
          newUuidV7(),
          principalId,
          CAPABILITY_CODES.taskBoardReadHumanV1,
          TASK_BOARD_READ_ACTION,
        ),
      );
      await repo.insertCapabilityGrant(
        trx,
        grant(
          newUuidV7(),
          servicePrincipalId,
          CAPABILITY_CODES.taskBoardSourceReadV1,
          TASK_BOARD_SOURCE_READ_ACTION,
        ),
      );
    });

    // The readable Project Board projection of the one Project.
    const projectionContext: EnterpriseProjectTransactionContext = {
      kind: 'REQUEST',
      principalId,
      principalKind: 'HUMAN',
      actorSnapshotId: newUuidV7(),
      authorizationDecisionId: newUuidV7(),
      authorizationDecisionHash: randomBytes(32),
      authorizationDecisionExpiresAt: new Date(Date.now() + 300_000),
      policySnapshotId,
      enterpriseId,
      allowedProjectIds: [projectId],
      correlationId: newUuidV7(),
    };
    const snapshotAt = new Date(Date.now() - 60_000).toISOString();
    const item: ProjectBoardProjectionItemInput = {
      deliveryItemId: newUuidV7(),
      itemKey: boardItemKey,
      itemType: 'delivery.output',
      title: 'Board Item',
      commitmentStatus: 'APPROVED',
      executionStatus: 'READY',
      blockerRefs: [],
    };
    const base = {
      projectRef: {
        kind: 'OBJECT',
        objectType: 'Project',
        objectId: projectId,
        scope: { enterpriseId, projectId },
      } satisfies Common.ObjectRef,
      snapshotAt,
      sourceWatermark: {
        sourceModule: 'enterprise_project',
        partition: projectId,
        sequence: 1,
        observedAt: snapshotAt,
      } satisfies Common.SourceWatermark,
      items: [item],
      sourceSnapshotHash: {
        algorithm: 'SHA-256',
        digest: '0'.repeat(64),
        canonicalizationVersion: '1',
      } satisfies Common.ContentHash,
    };
    const exportSnapshot: ProjectBoardSnapshotExport = {
      ...base,
      sourceEventId: newUuidV7(),
      sourceSnapshotHash: {
        algorithm: 'SHA-256',
        digest: calculateProjectBoardSnapshotHash(base),
        canonicalizationVersion: '1',
      },
    };
    await rebuildProjectBoardProjection(enterpriseProjectDb, projectionContext, exportSnapshot);

    return {
      enterpriseId,
      projectId,
      principalId,
      servicePrincipalId,
      enterpriseDisplayName,
      projectTitle,
      projectDisplayCode,
      boardItemKey,
      close: async () => {
        await enterprisePool.end();
        await identityPool.end();
        await admin.end();
      },
    };
  } catch (error) {
    await enterprisePool.end().catch(() => undefined);
    await identityPool.end().catch(() => undefined);
    await admin.end().catch(() => undefined);
    throw error;
  }
}
