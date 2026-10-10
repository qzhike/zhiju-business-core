// IM-UI-01 (#266 / #258): real-PostgreSQL acceptance for the authorized
// workspace project directory `project.find_workspace_projects@1.0`
// (Module-Spec-002 §258, Module-Spec-001 §258, Session Delta §4).
//
// The case drives the real Core dispatch (`createWorkspaceDispatch`) with a
// real `VerifiedOidcContext` built exactly as the trusted Core verifier builds
// it, so the whole trusted path runs: verified-Human resolution through the
// owning IdentityPolicy Port, the self-only `identity_workspace_discovery_reader`
// candidate scan, a per-candidate `project.workspace.discover` Decision, the
// EnterpriseProject owning per-Project read and the final revalidation.
//
// It writes only owning rows: EnterpriseProject fixtures are inserted as the
// container superuser (the pattern of `query-projection.test.ts`), every
// IdentityPolicy fact (principal, link, grant, revocation, policy snapshot) is
// written through the owning repository under a trusted RLS context. Nothing is
// mocked and no assertion is relaxed.

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IdentityPolicyRepository,
  authenticationContextHash,
  createIdentityPolicyDatabase,
  withIdentityTransaction,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityTransactionContext,
  type VerifiedOidcContextInput,
} from '@zhiju/identity-policy';
import {
  createEnterpriseProjectDatabase,
  type EnterpriseProjectDb,
} from '@zhiju/enterprise-project';
import { createTaskExecutionDatabase, type TaskExecutionDb } from '@zhiju/task-execution';
import { getContractRegistry } from '@zhiju/contracts';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  createWorkspaceDispatch,
  type WorkspaceDispatch,
} from '../../apps/api/src/workspace/dispatch.js';
import type { WorkspaceDispatchRequest } from '../../apps/api/src/workspace/controller.js';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;

const DIRECTORY_OPERATION = 'project.find_workspace_projects';
const DIRECTORY_VERSION = '1.0';
const DISCOVERY_ACTION = 'project.workspace.discover.v1';
const DISCOVERY_CODE = 'workspace.project.discover';
const OTHER_DISCOVERY_CODE = 'workspace.project.discover.other';
const BOARD_READ_CODE = 'project.board.slice.read';
const PROJECT_OBJECT_TYPE = 'zhiju.project.project';

/**
 * A single trusted observation instant; the clock advances only where tested.
 *
 * It is deliberately a fixed instant *after* any wall clock this suite runs
 * under: the platform RLS establisher refuses a transaction context whose
 * Decision expiry is not in the future on the real `clock_timestamp()`, while
 * the directory entry's own clock (cursor expiry, watermarks, Decision TTL)
 * stays exactly this deterministic value.
 */
const FIXED_NOW = new Date('2035-01-01T00:00:00.000Z');
const FIXED_MS = FIXED_NOW.getTime();

const OPERATOR = '018f1b00-0000-7000-8000-0000000000aa';

const E1 = '018f1a00-0000-7000-8000-0000000000e1';
const E2 = '018f1a00-0000-7000-8000-0000000000e2';
const E3 = '018f1a00-0000-7000-8000-0000000000e3';

const P1 = '018f1a01-0000-7000-8000-000000000001';
const P2 = '018f1a01-0000-7000-8000-000000000002';
const P3 = '018f1a02-0000-7000-8000-000000000003';
const P4 = '018f1a04-0000-7000-8000-000000000004';

const R1 = '018f1a11-0000-7000-8000-000000000011';
const R2 = '018f1a11-0000-7000-8000-000000000012';
const D1 = '018f1a21-0000-7000-8000-000000000021';
const D2 = '018f1a21-0000-7000-8000-000000000022';
const M1 = '018f1a31-0000-7000-8000-000000000031';
const M2 = '018f1a31-0000-7000-8000-000000000032';
const H1 = '018f1a41-0000-7000-8000-000000000041';
const H2 = '018f1a41-0000-7000-8000-000000000042';
const T1 = '018f1a51-0000-7000-8000-000000000051';
const T2 = '018f1a51-0000-7000-8000-000000000052';

const PRINCIPAL_A = '018f1b01-0000-7000-8000-0000000000a1';
const PRINCIPAL_B = '018f1b01-0000-7000-8000-0000000000b1';
const PRINCIPAL_R = '018f1b01-0000-7000-8000-0000000000c1';
const PRINCIPAL_D = '018f1b01-0000-7000-8000-0000000000d1';
const PRINCIPAL_M = '018f1b01-0000-7000-8000-0000000000f1';
const PRINCIPAL_F = '018f1b02-0000-7000-8000-0000000000f1';
const PRINCIPAL_H = '018f1b03-0000-7000-8000-0000000000f1';
const PRINCIPAL_T = '018f1b04-0000-7000-8000-0000000000f1';

const G_PREFIX = '018f1a60-0000-7000-8000-';
const BULK_CANDIDATES = 201;

function gProjectId(index: number): string {
  return `${G_PREFIX}${String(index).padStart(12, '0')}`;
}

/** The owning `insertCapabilityGrant` input of one fixture Grant. */
interface GrantFixture {
  id: string;
  principalId: string;
  code: string;
  scopeKind: 'ENTERPRISE' | 'PROJECT';
  enterpriseId: string;
  projectId?: string;
  validFrom: Date;
  justification: string;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  resourceSelectors: { selectorType: string; objectType: string }[];
  actions: string[];
  grantPolicySnapshotId: string;
  grantPolicySnapshotHash: Buffer;
}

/** Real keyed-lookup and field-encryption ports with test-only keys. */
function createCrypto(): IdentityCryptoPorts {
  const lookupKey = Buffer.alloc(32, 0x42);
  const fieldKey = Buffer.alloc(32, 0x24);
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

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`expected an object, received ${typeof value}`);
  }
  return value as Record<string, unknown>;
}

function itemsOf(data: Record<string, unknown>): Record<string, unknown>[] {
  const items = data.items;
  if (!Array.isArray(items)) throw new Error('data.items is not an array');
  return items as Record<string, unknown>[];
}

function projectIdOf(item: Record<string, unknown>): string {
  return String(asRecord(item.projectRef).objectId);
}

/** A deterministic login-session binding: stable per principal, ≥32 bytes. */
function sessionBindingFor(principalId: string): Buffer {
  return createHmac('sha256', 'wi266-directory-session').update(principalId).digest();
}

/**
 * Builds a `VerifiedOidcContext` shaped exactly like the trusted Core verifier
 * output; `authenticationContextHash` (owning IP canonicalization) is the only
 * accepted identity digest.
 */
function verifiedContext(principalId: string, sessionBinding: Buffer): VerifiedOidcContextInput {
  return {
    trustConfigHash: createHash('sha256').update('wi266-trust-config').digest('hex'),
    issuerConfigHash: 'wi266-issuer-config-v1',
    providerCode: 'keycloak',
    issuer: 'https://issuer.example.test/realms/zhiju',
    accountExternalId: `acct-${principalId}`,
    subjectExternalId: `subj-${principalId}`,
    clientId: 'zhiju-core',
    apiAudience: 'zhiju-api',
    azp: 'zhiju-bff',
    tokenSha256: createHash('sha256').update(`token-${principalId}`).digest(),
    issuedAt: new Date(FIXED_MS - 60_000),
    expiresAt: new Date(FIXED_MS + 600_000),
    validatedAt: FIXED_NOW,
    sessionBindingHash: sessionBinding,
  };
}

describe.skipIf(!databaseUrl)(
  'workspace authorized project directory #266 (real PostgreSQL)',
  () => {
    let admin: pg.Client;
    let appPool: pg.Pool;
    let db: Kysely<IdentityPolicyDb>;
    let epDb: Kysely<EnterpriseProjectDb>;
    let teDb: Kysely<TaskExecutionDb>;
    let repo: IdentityPolicyRepository;
    let dispatch: WorkspaceDispatch;
    const clock = FIXED_NOW;
    const crypto = createCrypto();
    let policySnapshotId = '';
    let policySnapshotHash = Buffer.alloc(0);
    let bGrantId = '';
    let r1GrantId = '';
    let d2GrantId = '';
    const contexts = new Map<string, { context: VerifiedOidcContextInput; binding: Buffer }>();

    const operatorContext = (
      enterpriseId: string,
      allowedProjectIds: readonly string[],
    ): IdentityTransactionContext => ({
      kind: 'REQUEST',
      principalId: OPERATOR,
      actorSnapshotId: newUuidV7(),
      authorizationDecisionId: newUuidV7(),
      authorizationDecisionHash: randomBytes(32),
      authorizationDecisionExpiresAt: new Date(FIXED_MS + 600_000),
      enterpriseId,
      allowedProjectIds: [...allowedProjectIds],
      correlationId: newUuidV7(),
    });

    function buildDispatch(now: () => Date): WorkspaceDispatch {
      return createWorkspaceDispatch({
        identity: { db, repo, crypto },
        enterpriseProjectDb: epDb,
        taskExecutionDb: teDb,
        capabilityCodes: {
          workspaceProjectDiscoveryHumanV1: DISCOVERY_CODE,
          projectBoardSliceReadHumanV1: BOARD_READ_CODE,
          taskBoardReadHumanV1: 'task.board.read',
          taskBoardSourceReadV1: 'task.board.source.read',
          taskBoardHealthReadV1: 'task.board.health.read',
          taskBoardPolicyReadV1: 'task.board.policy.read',
        },
        boardService: { principalId: OPERATOR },
        boardPolicyRef: () => undefined,
        cursorKey: { keyId: 1, secret: Buffer.alloc(32, 9) },
        now,
      });
    }

    function directoryBody(options: {
      readonly pageSize: number;
      readonly cursor?: string;
      readonly searchText?: string;
      readonly scopeRef?: Record<string, unknown>;
      readonly payloadExtra?: Record<string, unknown>;
    }): Record<string, unknown> {
      const page: Record<string, unknown> = { pageSize: options.pageSize };
      if (options.cursor !== undefined) page.cursor = options.cursor;
      const payload: Record<string, unknown> = {
        page,
        ...(options.searchText === undefined ? {} : { searchText: options.searchText }),
        ...(options.payloadExtra ?? {}),
      };
      return {
        queryId: newUuidV7(),
        type: DIRECTORY_OPERATION,
        version: DIRECTORY_VERSION,
        scopeRef: options.scopeRef ?? {},
        consistencyRequirement: 'AUTHORITATIVE',
        pagination: { pageSize: options.pageSize },
        correlationId: newUuidV7(),
        requestedAt: FIXED_NOW.toISOString(),
        payload,
      };
    }

    function requestFor(
      principalId: string,
      body: Record<string, unknown>,
      bindingOverride?: Buffer,
    ): WorkspaceDispatchRequest {
      const stored = contexts.get(principalId);
      if (stored === undefined) throw new Error(`no session for ${principalId}`);
      const binding = bindingOverride ?? stored.binding;
      return {
        kind: 'QUERY',
        operation: DIRECTORY_OPERATION,
        version: DIRECTORY_VERSION,
        body,
        context:
          bindingOverride === undefined ? stored.context : verifiedContext(principalId, binding),
        sessionBinding: binding,
        correlationId: newUuidV7(),
      };
    }

    async function execute(
      principalId: string,
      body: Record<string, unknown>,
      bindingOverride?: Buffer,
    ): Promise<{ status: number; payload: Record<string, unknown> }> {
      const response = await dispatch.execute(requestFor(principalId, body, bindingOverride));
      return { status: response.status, payload: asRecord(response.payload) };
    }

    function expectOk(payload: Record<string, unknown>): Record<string, unknown> {
      expect(payload.status).toBe('OK');
      return asRecord(payload.data);
    }

    function expectFailure(
      result: { status: number; payload: Record<string, unknown> },
      code: string,
      status: number,
    ): void {
      expect(result.status).toBe(status);
      expect(result.payload.code).toBe(code);
      expect(result.payload).not.toHaveProperty('data');
    }

    /** Expected canonical authentication context hash of one principal. */
    function expectedAuthHash(principalId: string): string {
      const stored = contexts.get(principalId);
      if (stored === undefined) throw new Error(`no session for ${principalId}`);
      return authenticationContextHash(stored.context, crypto).authenticationContextHash.toString(
        'hex',
      );
    }

    async function insertPrincipals(): Promise<void> {
      await withIdentityTransaction(db, operatorContext(E1, []), async (trx) => {
        for (const [id, displayName] of [
          [PRINCIPAL_A, 'Consultant A'],
          [PRINCIPAL_B, 'Consultant B'],
          [PRINCIPAL_R, 'Consultant R'],
          [PRINCIPAL_D, 'Consultant D'],
          [PRINCIPAL_M, 'Consultant M'],
          [PRINCIPAL_F, 'Consultant F'],
          [PRINCIPAL_H, 'Consultant H'],
          [PRINCIPAL_T, 'Consultant T'],
        ] as const) {
          await repo.insertPrincipal(trx, {
            id,
            principalKind: 'HUMAN',
            displayName,
            createdByPrincipalId: OPERATOR,
            createdByActorSnapshotId: newUuidV7(),
          });
        }
      });
    }

    async function insertLinks(): Promise<void> {
      for (const principalId of [
        PRINCIPAL_A,
        PRINCIPAL_R,
        PRINCIPAL_D,
        PRINCIPAL_M,
        PRINCIPAL_F,
        PRINCIPAL_H,
        PRINCIPAL_T,
      ]) {
        await withIdentityTransaction(db, operatorContext(E1, []), async (trx) => {
          const inserted = await repo.insertExternalIdentityLink(trx, {
            id: newUuidV7(),
            providerCode: 'keycloak',
            accountExternalId: `acct-${principalId}`,
            subjectExternalId: `subj-${principalId}`,
            principalId,
            verifiedAt: FIXED_NOW,
            verificationMethod: 'wi266-controlled-test-link',
            evidenceRefs: { fixture: 'wi266-directory' },
            createdByPrincipalId: OPERATOR,
            createdByActorSnapshotId: newUuidV7(),
          });
          expect(inserted).toBe(true);
        });
      }
    }

    function grantInput(options: {
      readonly id: string;
      readonly principalId: string;
      readonly code: string;
      readonly scopeKind: 'ENTERPRISE' | 'PROJECT';
      readonly enterpriseId: string;
      readonly projectId?: string;
      readonly actions: readonly string[];
    }): GrantFixture {
      return {
        id: options.id,
        principalId: options.principalId,
        code: options.code,
        scopeKind: options.scopeKind,
        enterpriseId: options.enterpriseId,
        ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
        validFrom: new Date(FIXED_MS - 60_000),
        justification: 'wi266 controlled directory fixture',
        createdByPrincipalId: OPERATOR,
        createdByActorSnapshotId: newUuidV7(),
        resourceSelectors: [{ selectorType: 'TARGET_TYPE', objectType: PROJECT_OBJECT_TYPE }],
        actions: [...options.actions],
        grantPolicySnapshotId: policySnapshotId,
        grantPolicySnapshotHash: policySnapshotHash,
      };
    }

    async function insertGrants(
      enterpriseId: string,
      allowedProjectIds: readonly string[],
      grants: readonly GrantFixture[],
    ): Promise<void> {
      await withIdentityTransaction(
        db,
        operatorContext(enterpriseId, allowedProjectIds),
        async (trx) => {
          for (const grant of grants) {
            await repo.insertCapabilityGrant(trx, grant);
          }
        },
      );
    }

    async function insertProject(options: {
      readonly enterpriseId: string;
      readonly projectId: string;
      readonly displayCode: string;
      readonly title: string;
      readonly status: string;
      readonly aggregateVersion: number;
    }): Promise<void> {
      const versionId = newUuidV7();
      await admin.query(
        `INSERT INTO enterprise_project.project
           (project_id, enterprise_id, display_code, title, objective,
            member_policy_ref, member_policy_version_id, member_policy_payload_hash,
            status, aggregate_version, created_by_principal_id, created_by_actor_snapshot_id,
            last_command_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13)`,
        [
          options.projectId,
          options.enterpriseId,
          options.displayCode,
          options.title,
          `Objective for ${options.projectId}`,
          JSON.stringify({
            kind: 'VERSIONED',
            objectType: 'Policy',
            objectId: newUuidV7(),
            versionId,
            scope: { enterpriseId: options.enterpriseId },
          }),
          versionId,
          Buffer.alloc(32, 0x33),
          options.status,
          options.aggregateVersion,
          OPERATOR,
          newUuidV7(),
          newUuidV7(),
        ],
      );
    }

    async function seedEnterpriseProject(): Promise<void> {
      await admin.query('BEGIN');
      try {
        for (const [enterpriseId, displayCode, displayName] of [
          [E1, 'EN-ONE', 'Enterprise One'],
          [E2, 'EN-TWO', 'Enterprise Two'],
          [E3, 'EN-THREE', 'Enterprise Three'],
        ] as const) {
          await admin.query(
            `INSERT INTO enterprise_project.enterprise
               (enterprise_id, display_code, display_name, status, aggregate_version,
                created_by_principal_id, created_by_actor_snapshot_id)
             VALUES ($1, $2, $3, 'ACTIVE', 1, $4, $5)`,
            [enterpriseId, displayCode, displayName, OPERATOR, newUuidV7()],
          );
        }
        await insertProject({
          enterpriseId: E1,
          projectId: P1,
          displayCode: 'P1-CODE',
          title: 'Project One',
          status: 'ACTIVE',
          aggregateVersion: 3,
        });
        await insertProject({
          enterpriseId: E1,
          projectId: P2,
          displayCode: 'P2-CODE',
          title: 'Project Two',
          status: 'SUSPENDED',
          aggregateVersion: 5,
        });
        await insertProject({
          enterpriseId: E2,
          projectId: P3,
          displayCode: 'P3-CODE',
          title: 'Project Three',
          status: 'ACTIVE',
          aggregateVersion: 1,
        });
        for (const [projectId, displayCode] of [
          [R1, 'R1-CODE'],
          [R2, 'R2-CODE'],
          [D1, 'D1-CODE'],
          [D2, 'D2-CODE'],
          [M1, 'M1-CODE'],
          [H1, 'H1-MATCH'],
          [H2, 'H2-NOPE'],
          [T1, 'T1-CODE'],
          [T2, 'T2-CODE'],
        ] as const) {
          await insertProject({
            enterpriseId: E1,
            projectId,
            displayCode,
            title: `Fixture ${displayCode}`,
            status: 'ACTIVE',
            aggregateVersion: 2,
          });
        }
        for (let index = 1; index <= BULK_CANDIDATES; index += 1) {
          const label = String(index).padStart(3, '0');
          const matching = index === BULK_CANDIDATES;
          await insertProject({
            enterpriseId: E3,
            projectId: gProjectId(index),
            displayCode: matching ? 'G-NEEDLE' : `G-${label}`,
            title: matching ? 'Needle project' : `Project ${label}`,
            status: 'ACTIVE',
            aggregateVersion: 1,
          });
        }
        await admin.query('COMMIT');
      } catch (error) {
        await admin.query('ROLLBACK');
        throw error;
      }
    }

    async function seedCapabilityGrants(): Promise<void> {
      bGrantId = newUuidV7();
      r1GrantId = newUuidV7();
      d2GrantId = newUuidV7();
      const enterpriseGrants = [
        grantInput({
          id: newUuidV7(),
          principalId: PRINCIPAL_A,
          code: DISCOVERY_CODE,
          scopeKind: 'PROJECT',
          enterpriseId: E1,
          projectId: P1,
          actions: [DISCOVERY_ACTION],
        }),
        grantInput({
          id: newUuidV7(),
          principalId: PRINCIPAL_A,
          code: DISCOVERY_CODE,
          scopeKind: 'PROJECT',
          enterpriseId: E1,
          projectId: P2,
          actions: [DISCOVERY_ACTION],
        }),
        grantInput({
          id: newUuidV7(),
          principalId: PRINCIPAL_A,
          code: DISCOVERY_CODE,
          scopeKind: 'ENTERPRISE',
          enterpriseId: E1,
          actions: [DISCOVERY_ACTION],
        }),
        grantInput({
          id: bGrantId,
          principalId: PRINCIPAL_B,
          code: DISCOVERY_CODE,
          scopeKind: 'PROJECT',
          enterpriseId: E1,
          projectId: P4,
          actions: [DISCOVERY_ACTION],
        }),
        grantInput({
          id: r1GrantId,
          principalId: PRINCIPAL_R,
          code: DISCOVERY_CODE,
          scopeKind: 'PROJECT',
          enterpriseId: E1,
          projectId: R1,
          actions: [DISCOVERY_ACTION],
        }),
        grantInput({
          id: newUuidV7(),
          principalId: PRINCIPAL_R,
          code: DISCOVERY_CODE,
          scopeKind: 'PROJECT',
          enterpriseId: E1,
          projectId: R2,
          actions: [DISCOVERY_ACTION],
        }),
        grantInput({
          id: newUuidV7(),
          principalId: PRINCIPAL_D,
          code: DISCOVERY_CODE,
          scopeKind: 'PROJECT',
          enterpriseId: E1,
          projectId: D1,
          actions: [DISCOVERY_ACTION],
        }),
        grantInput({
          id: d2GrantId,
          principalId: PRINCIPAL_D,
          code: DISCOVERY_CODE,
          scopeKind: 'PROJECT',
          enterpriseId: E1,
          projectId: D2,
          actions: [DISCOVERY_ACTION],
        }),
        grantInput({
          id: newUuidV7(),
          principalId: PRINCIPAL_M,
          code: DISCOVERY_CODE,
          scopeKind: 'PROJECT',
          enterpriseId: E1,
          projectId: M1,
          actions: [DISCOVERY_ACTION],
        }),
        grantInput({
          id: newUuidV7(),
          principalId: PRINCIPAL_M,
          code: DISCOVERY_CODE,
          scopeKind: 'PROJECT',
          enterpriseId: E1,
          projectId: M2,
          actions: [DISCOVERY_ACTION],
        }),
        grantInput({
          id: newUuidV7(),
          principalId: PRINCIPAL_H,
          code: DISCOVERY_CODE,
          scopeKind: 'PROJECT',
          enterpriseId: E1,
          projectId: H1,
          actions: [DISCOVERY_ACTION],
        }),
        grantInput({
          id: newUuidV7(),
          principalId: PRINCIPAL_H,
          code: DISCOVERY_CODE,
          scopeKind: 'PROJECT',
          enterpriseId: E1,
          projectId: H2,
          actions: [DISCOVERY_ACTION],
        }),
        grantInput({
          id: newUuidV7(),
          principalId: PRINCIPAL_T,
          code: DISCOVERY_CODE,
          scopeKind: 'PROJECT',
          enterpriseId: E1,
          projectId: T1,
          actions: [DISCOVERY_ACTION],
        }),
        grantInput({
          id: newUuidV7(),
          principalId: PRINCIPAL_T,
          code: DISCOVERY_CODE,
          scopeKind: 'PROJECT',
          enterpriseId: E1,
          projectId: T2,
          actions: [DISCOVERY_ACTION],
        }),
      ];
      await insertGrants(
        E1,
        [P1, P2, P4, R1, R2, D1, D2, M1, M2, H1, H2, T1, T2],
        enterpriseGrants,
      );

      // The differently-coded Project grant of principal A on (E2, P3): a valid
      // discovery Grant under another deployment capability code, never a
      // candidate of this deployment's code.
      await insertGrants(
        E2,
        [P3],
        [
          grantInput({
            id: newUuidV7(),
            principalId: PRINCIPAL_A,
            code: OTHER_DISCOVERY_CODE,
            scopeKind: 'PROJECT',
            enterpriseId: E2,
            projectId: P3,
            actions: [DISCOVERY_ACTION],
          }),
        ],
      );

      const bulkGrants = Array.from({ length: BULK_CANDIDATES }, (_unused, offset) =>
        grantInput({
          id: `018f1a61-0000-7000-8000-${String(offset + 1).padStart(12, '0')}`,
          principalId: PRINCIPAL_F,
          code: DISCOVERY_CODE,
          scopeKind: 'PROJECT',
          enterpriseId: E3,
          projectId: gProjectId(offset + 1),
          actions: [DISCOVERY_ACTION],
        }),
      );
      const bulkProjectIds = Array.from({ length: BULK_CANDIDATES }, (_unused, offset) =>
        gProjectId(offset + 1),
      );
      await insertGrants(E3, bulkProjectIds, bulkGrants);
    }

    async function countDiscoveryDecisions(projectId: string): Promise<number> {
      const rows = (
        await admin.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM identity_policy.authorization_decision
             WHERE command_type = $1 AND project_id = $2`,
          ['project.workspace.discover', projectId],
        )
      ).rows;
      return rows[0]?.n ?? -1;
    }

    async function revokeGrant(
      grantId: string,
      enterpriseId: string,
      projectId: string,
    ): Promise<void> {
      await withIdentityTransaction(db, operatorContext(enterpriseId, [projectId]), async (trx) => {
        await repo.markCapabilityGrantRevoked(trx, grantId, newUuidV7());
        await repo.insertCapabilityRevocation(trx, {
          revocationId: newUuidV7(),
          targetId: grantId,
          scopeKind: 'PROJECT',
          enterpriseId,
          projectId,
          revokedByPrincipalId: OPERATOR,
          reasonCode: 'wi266-controlled-revocation',
          effectiveAt: FIXED_NOW,
          actorSnapshotId: newUuidV7(),
          sourceCommandId: newUuidV7(),
        });
      });
    }

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      appPool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
      db = createIdentityPolicyDatabase(appPool);
      epDb = createEnterpriseProjectDatabase(appPool);
      teDb = createTaskExecutionDatabase(appPool);
      repo = new IdentityPolicyRepository(crypto);

      for (const principalId of [
        PRINCIPAL_A,
        PRINCIPAL_B,
        PRINCIPAL_R,
        PRINCIPAL_D,
        PRINCIPAL_M,
        PRINCIPAL_F,
        PRINCIPAL_H,
        PRINCIPAL_T,
      ]) {
        const binding = sessionBindingFor(principalId);
        contexts.set(principalId, { context: verifiedContext(principalId, binding), binding });
      }

      await insertPrincipals();
      await insertLinks();

      await withIdentityTransaction(db, operatorContext(E1, []), async (trx) => {
        await repo.insertPolicySnapshot(trx, {
          policySnapshotId: newUuidV7(),
          policySetVersion: `wi266-directory-${process.pid}-${FIXED_MS}`,
          policySchemaRefs: [],
          effectiveFrom: new Date(FIXED_MS - 60_000),
          contractVersion: '1.0',
          schemaRegistryVersion: 'im02-static-v1',
          policyDocument: { note: 'wi266 controlled directory fixture' },
          createdByPrincipalId: OPERATOR,
          actorSnapshotId: newUuidV7(),
          sourceCommandId: newUuidV7(),
          dataClassification: 'INTERNAL',
        });
      });
      const snapshot = (
        await admin.query<{ policy_snapshot_id: string; payload_hash: Buffer }>(
          `SELECT policy_snapshot_id, payload_hash FROM identity_policy.policy_snapshot
             WHERE policy_set_version = $1`,
          [`wi266-directory-${process.pid}-${FIXED_MS}`],
        )
      ).rows[0];
      if (snapshot === undefined) throw new Error('policy snapshot fixture missing');
      policySnapshotId = snapshot.policy_snapshot_id;
      policySnapshotHash = Buffer.from(snapshot.payload_hash);

      await seedCapabilityGrants();
      await seedEnterpriseProject();

      dispatch = buildDispatch(() => clock);
    }, 120_000);

    afterAll(async () => {
      await admin.end().catch(() => undefined);
      await appPool.end().catch(() => undefined);
    });

    it('case 1: a linked ACTIVE Human gets exactly the two authorized cards in (enterpriseId, projectId) order', async () => {
      const expectedContextHash = expectedAuthHash(PRINCIPAL_A);
      expect(expectedContextHash).toHaveLength(64);

      const result = await execute(PRINCIPAL_A, directoryBody({ pageSize: 25 }));
      expect(result.status).toBe(200);
      const data = expectOk(result.payload);
      const items = itemsOf(data);
      expect(items.map(projectIdOf)).toEqual([P1, P2]);

      const first = asRecord(items[0]);
      expect(first.enterpriseDisplayName).toBe('Enterprise One');
      expect(first.displayCode).toBe('P1-CODE');
      expect(first.title).toBe('Project One');
      expect(first.status).toBe('ACTIVE');
      expect(first.aggregateVersion).toBe(3);
      expect(asRecord(first.enterpriseRef).objectId).toBe(E1);
      expect(asRecord(first.projectRef).objectType).toBe(PROJECT_OBJECT_TYPE);

      const second = asRecord(items[1]);
      expect(second.displayCode).toBe('P2-CODE');
      expect(second.title).toBe('Project Two');
      expect(second.status).toBe('SUSPENDED');
      expect(second.aggregateVersion).toBe(5);

      // No global total, no existence/count leak of the ENTERPRISE grant, the
      // differently-coded E2/P3 grant or principal B's grant.
      expect(data).not.toHaveProperty('total');
      expect(data).not.toHaveProperty('totalCount');
      const serialized = JSON.stringify(result.payload);
      expect(serialized).not.toContain(P3);
      expect(serialized).not.toContain(P4);
      expect(serialized).not.toContain(E2);
      expect(result.payload).not.toHaveProperty('nextCursor');
      expect(data).not.toHaveProperty('nextCursor');
    }, 60_000);

    it('case 2: a verified Human without a link is refused with the single safe code and no read', async () => {
      const before = await countDiscoveryDecisions(P1);
      const result = await execute(PRINCIPAL_B, directoryBody({ pageSize: 25 }));
      expectFailure(result, 'ACCESS_DENIED', 403);
      expect(result.payload).not.toHaveProperty('data');
      expect(result.payload).not.toHaveProperty('status');
      expect(await countDiscoveryDecisions(P1)).toBe(before);
    }, 30_000);

    it('case 3: a non-empty scopeRef is SCOPE_MISMATCH and a body override is refused before any read', async () => {
      const before = await countDiscoveryDecisions(P1);

      const scoped = await execute(
        PRINCIPAL_A,
        directoryBody({ pageSize: 25, scopeRef: { enterpriseId: E1 } }),
      );
      expectFailure(scoped, 'API_VALUE_INVALID', 400);

      const override = await execute(
        PRINCIPAL_A,
        directoryBody({
          pageSize: 25,
          payloadExtra: {
            actor: { kind: 'OBJECT', objectType: 'identity.principal', objectId: PRINCIPAL_A },
          },
        }),
      );
      expectFailure(override, 'API_VALUE_INVALID', 400);

      expect(await countDiscoveryDecisions(P1)).toBe(before);
    }, 30_000);

    it('case 4: a revoked P1 grant disappears from a fresh page and invalidates the pre-revocation cursor', async () => {
      const first = await execute(PRINCIPAL_R, directoryBody({ pageSize: 1 }));
      const firstData = expectOk(first.payload);
      expect(itemsOf(firstData).map(projectIdOf)).toEqual([R1]);
      const cursor = firstData.nextCursor;
      expect(typeof cursor).toBe('string');

      await revokeGrant(r1GrantId, E1, R1);

      const fresh = await execute(PRINCIPAL_R, directoryBody({ pageSize: 25 }));
      const freshData = expectOk(fresh.payload);
      expect(itemsOf(freshData).map(projectIdOf)).toEqual([R2]);
      expect(freshData).not.toHaveProperty('nextCursor');

      const stale = await execute(
        PRINCIPAL_R,
        directoryBody({ pageSize: 1, cursor: cursor as string }),
      );
      expectFailure(stale, 'QUERY_CURSOR_SCOPE_MISMATCH', 400);
    }, 60_000);

    it('case 5a: the scan budget yields an empty first page with a bound cursor that reaches the 201st candidate', async () => {
      const first = await execute(
        PRINCIPAL_F,
        directoryBody({ pageSize: 50, searchText: 'needle' }),
      );
      expect(first.status).toBe(200);
      const firstData = expectOk(first.payload);
      expect(itemsOf(firstData)).toHaveLength(0);
      const firstCursor = firstData.nextCursor;
      expect(typeof firstCursor).toBe('string');
      // The Page and the envelope carry the identical cursor: the client stays
      // in LOADING rather than claiming a complete empty directory.
      expect(first.payload.nextCursor).toBe(firstCursor);

      let cursor: string | undefined = firstCursor as string;
      let matching: Record<string, unknown>[] | undefined;
      let pages = 1;
      while (cursor !== undefined && pages < 12) {
        const result = await execute(
          PRINCIPAL_F,
          directoryBody({ pageSize: 50, searchText: 'needle', cursor }),
        );
        const data = expectOk(result.payload);
        pages += 1;
        const items = itemsOf(data);
        if (items.length > 0) {
          matching = items;
          // A terminal page (the matching candidate) omits both cursors.
          expect(data).not.toHaveProperty('nextCursor');
          expect(result.payload).not.toHaveProperty('nextCursor');
          break;
        }
        expect(result.payload.nextCursor).toBe(data.nextCursor);
        cursor = data.nextCursor as string | undefined;
      }
      expect(matching?.map(projectIdOf)).toEqual([gProjectId(BULK_CANDIDATES)]);
      expect(pages).toBeGreaterThan(1);
    }, 300_000);

    it('case 5b: a non-empty page followed by an empty terminal page keeps the earlier cards', async () => {
      const first = await execute(PRINCIPAL_H, directoryBody({ pageSize: 1, searchText: 'match' }));
      const firstData = expectOk(first.payload);
      expect(itemsOf(firstData).map(projectIdOf)).toEqual([H1]);
      const cursor = firstData.nextCursor;
      expect(typeof cursor).toBe('string');

      const second = await execute(
        PRINCIPAL_H,
        directoryBody({ pageSize: 1, searchText: 'match', cursor: cursor as string }),
      );
      const secondData = expectOk(second.payload);
      expect(itemsOf(secondData)).toHaveLength(0);
      expect(secondData).not.toHaveProperty('nextCursor');
      expect(second.payload).not.toHaveProperty('nextCursor');
    }, 60_000);

    it('case 5c: tampered / expired / foreign-session cursors are refused as cursor failures', async () => {
      const localClock = { value: FIXED_NOW };
      const localDispatch = buildDispatch(() => localClock.value);

      const first = await localDispatch.execute(
        requestFor(PRINCIPAL_T, directoryBody({ pageSize: 1 })),
      );
      const firstData = expectOk(asRecord(first.payload));
      const cursor = String(firstData.nextCursor);

      // Tamper with a decoded payload byte: flipping the last base64 character
      // can leave the decoded bytes untouched when it only carries padding bits,
      // which would make this counter-example flaky instead of deterministic.
      const cursorBytes = Buffer.from(cursor, 'base64url');
      const firstByte = cursorBytes.at(0);
      if (firstByte === undefined) throw new Error('the served cursor is empty');
      cursorBytes.set([firstByte ^ 0xff], 0);
      const tampered = cursorBytes.toString('base64url');
      const tamperedResult = await localDispatch.execute(
        requestFor(PRINCIPAL_T, directoryBody({ pageSize: 1, cursor: tampered })),
      );
      expectFailure(
        { status: tamperedResult.status, payload: asRecord(tamperedResult.payload) },
        'QUERY_CURSOR_INVALID',
        400,
      );

      // A foreign login session binding cannot verify the session-bound MAC.
      const foreignBinding = createHmac('sha256', 'wi266-foreign-session')
        .update(PRINCIPAL_T)
        .digest();
      const foreignResult = await localDispatch.execute(
        requestFor(PRINCIPAL_T, directoryBody({ pageSize: 1, cursor }), foreignBinding),
      );
      const foreignPayload = asRecord(foreignResult.payload);
      expect(foreignResult.status).toBe(400);
      // Spec 002 §258 lists a Session change under QUERY_CURSOR_SCOPE_MISMATCH;
      // the landed cursor MACs with the session binding, so a foreign session
      // fails verification first and is reported as QUERY_CURSOR_INVALID. Both
      // are the CURSOR class (the client restarts at page one); reported to Main
      // as a spec/implementation wording mismatch, not relaxed here.
      expect(foreignPayload.code).toBe('QUERY_CURSOR_INVALID');

      localClock.value = new Date(FIXED_MS + 6 * 60_000);
      const expiredResult = await localDispatch.execute(
        requestFor(PRINCIPAL_T, directoryBody({ pageSize: 1, cursor })),
      );
      expectFailure(
        { status: expiredResult.status, payload: asRecord(expiredResult.payload) },
        'QUERY_CURSOR_EXPIRED',
        400,
      );
    }, 60_000);

    it('case 6: per-candidate independence — revoking P2 keeps P1 and issues no Decision for the revoked candidate', async () => {
      const first = await execute(PRINCIPAL_D, directoryBody({ pageSize: 25 }));
      const firstData = expectOk(first.payload);
      expect(itemsOf(firstData).map(projectIdOf)).toEqual([D1, D2]);
      const decisionsForD2 = await countDiscoveryDecisions(D2);
      expect(decisionsForD2).toBeGreaterThan(0);

      await revokeGrant(d2GrantId, E1, D2);

      const after = await execute(PRINCIPAL_D, directoryBody({ pageSize: 25 }));
      const afterData = expectOk(after.payload);
      expect(itemsOf(afterData).map(projectIdOf)).toEqual([D1]);
      expect(await countDiscoveryDecisions(D2)).toBe(decisionsForD2);
    }, 60_000);

    it('case 7: a candidate with no EnterpriseProject row is skipped without inventing a card', async () => {
      const result = await execute(PRINCIPAL_M, directoryBody({ pageSize: 25 }));
      const data = expectOk(result.payload);
      expect(itemsOf(data).map(projectIdOf)).toEqual([M1]);
      expect(JSON.stringify(result.payload)).not.toContain(M2);
    }, 60_000);

    it('case 8: the reader-role connection sees only the verified principal project rows', async () => {
      const role = `wi266_dir_probe_${process.pid}_${Math.floor(Date.now() % 1_000_000)}`;
      const password = 'wi266-dir-probe-password';
      await admin.query(
        `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE`,
      );
      try {
        await admin.query(
          `GRANT platform_context_establisher TO ${role} WITH INHERIT FALSE, SET TRUE`,
        );
        await admin.query(
          `GRANT identity_workspace_discovery_reader TO ${role} WITH INHERIT FALSE, SET TRUE`,
        );
        const url = new URL(databaseUrl ?? '');
        url.username = role;
        url.password = password;
        const client = new pg.Client({ connectionString: url.toString() });
        await client.connect();
        try {
          await client.query('BEGIN');
          await client.query('SET LOCAL ROLE platform_context_establisher');
          await client.query(
            `SELECT platform_security.establish_transaction_context(
               'REQUEST', $1::uuid, $2::uuid, $3::uuid, $4::bytea, $5::timestamptz,
               $6::uuid, $7::uuid[], $8::uuid, NULL)`,
            [
              PRINCIPAL_A,
              newUuidV7(),
              newUuidV7(),
              randomBytes(32),
              new Date(FIXED_MS + 600_000).toISOString(),
              E1,
              [],
              newUuidV7(),
            ],
          );
          await client.query('SET LOCAL ROLE identity_workspace_discovery_reader');
          const rows = (
            await client.query<{ id: string; principal_id: string; scope_kind: string }>(
              `SELECT id, principal_id, scope_kind FROM identity_policy.capability_grant ORDER BY id`,
            )
          ).rows;
          // A's own PROJECT rows only: P1/P2 under the discovery code and the
          // P3 row under another code; the ENTERPRISE row and B's grant are not
          // exposed even though the reader role holds SELECT on the table.
          expect(rows).toHaveLength(3);
          expect(rows.every((row) => row.principal_id === PRINCIPAL_A)).toBe(true);
          expect(rows.every((row) => row.scope_kind === 'PROJECT')).toBe(true);
          expect(rows.some((row) => row.id === bGrantId)).toBe(false);
        } finally {
          await client.query('ROLLBACK').catch(() => undefined);
          await client.end().catch(() => undefined);
        }
      } finally {
        await admin
          .query(`REVOKE identity_workspace_discovery_reader FROM ${role}`)
          .catch(() => undefined);
        await admin
          .query(`REVOKE platform_context_establisher FROM ${role}`)
          .catch(() => undefined);
        await admin.query(`DROP OWNED BY ${role}`).catch(() => undefined);
        await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined);
      }
    }, 60_000);

    it('case 9: the result envelope validates against the registry and the cursor chain keeps snapshotAt/watermarks stable', async () => {
      const registry = getContractRegistry();

      const first = await execute(PRINCIPAL_A, directoryBody({ pageSize: 1 }));
      const firstData = expectOk(first.payload);
      expect(
        registry.validateOperationResult(DIRECTORY_OPERATION, DIRECTORY_VERSION, firstData).valid,
      ).toBe(true);
      expect(itemsOf(firstData).map(projectIdOf)).toEqual([P1]);
      const cursor = firstData.nextCursor;
      expect(typeof cursor).toBe('string');
      expect(firstData.snapshotAt).toBe(FIXED_NOW.toISOString());
      expect(first.payload.snapshotAt).toBe(firstData.snapshotAt);

      const second = await execute(
        PRINCIPAL_A,
        directoryBody({ pageSize: 1, cursor: cursor as string }),
      );
      const secondData = expectOk(second.payload);
      expect(
        registry.validateOperationResult(DIRECTORY_OPERATION, DIRECTORY_VERSION, secondData).valid,
      ).toBe(true);
      expect(itemsOf(secondData).map(projectIdOf)).toEqual([P2]);
      expect(secondData).not.toHaveProperty('nextCursor');

      expect(secondData.snapshotAt).toBe(firstData.snapshotAt);
      expect(secondData.sourceWatermarks).toEqual(firstData.sourceWatermarks);
      expect(second.payload.snapshotAt).toBe(first.payload.snapshotAt);
      expect(second.payload.sourceWatermarks).toEqual(first.payload.sourceWatermarks);
    }, 60_000);
  },
);
