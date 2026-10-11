// Issue #266 / Module-Spec-001 §258 and 07-logical-model §258: the
// self-discovery read boundary is a dedicated, self-only SELECT role. This
// case proves the boundary on real PostgreSQL: the reader role sees only the
// verified context principal's own candidate rows, cannot see another
// principal, cannot read a platform table, cannot write, and does not bypass
// RLS. It writes only the owning fixtures it needs, through the owning
// repository, never invented business state.

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createIdentityPolicyDatabase,
  IdentityPolicyRepository,
  withIdentityTransaction,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';
import { newUuidV7 } from '@zhiju/shared-kernel';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const DISCOVERY_READER_ROLE = 'identity_workspace_discovery_reader';
const DISCOVERY_ACTION = 'project.workspace.discover.v1';
const DISCOVERY_CAPABILITY_CODE = 'workspace.project.discover';
const OPERATOR_ID = '018f2a00-0000-7000-8000-0000000000aa';
const ENTERPRISE_ID = '018f2a00-0000-7000-8000-0000000000e1';
const PROJECT_A = '018f2a00-0000-7000-8000-0000000000a1';
const PROJECT_B = '018f2a00-0000-7000-8000-0000000000b1';
const PROBE_ROLE = `wi266_probe_${process.pid}_${Math.floor(Date.now() % 1_000_000)}`;

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

describe.skipIf(!databaseUrl)(
  'workspace self-discovery read boundary #266 (real PostgreSQL)',
  () => {
    let admin: pg.Client;
    let appPool: pg.Pool;
    let db: Kysely<IdentityPolicyDb>;
    let repo: IdentityPolicyRepository;
    const crypto = createCrypto();
    const probePassword = 'wi266-probe-password';
    let principalA = '';
    let principalB = '';
    let policySnapshotId = '';
    let policySnapshotHash: Buffer = Buffer.alloc(0);

    const contextFor = (
      principalId: string,
      options: { readonly projectIds?: readonly string[]; readonly enterpriseId?: string } = {},
    ): IdentityTransactionContext => ({
      kind: 'REQUEST',
      principalId,
      actorSnapshotId: newUuidV7(),
      authorizationDecisionId: newUuidV7(),
      authorizationDecisionHash: randomBytes(32),
      authorizationDecisionExpiresAt: new Date(Date.now() + 60_000),
      enterpriseId: options.enterpriseId ?? ENTERPRISE_ID,
      allowedProjectIds: [...(options.projectIds ?? [])],
      correlationId: newUuidV7(),
    });

    /** Establishes the trusted RLS context and switches to the reader role. */
    async function openAsReader(
      principalId: string,
      allowedProjectIds: readonly string[],
    ): Promise<{ rows: Record<string, unknown>[]; client: pg.Client }> {
      const url = new URL(databaseUrl ?? '');
      url.username = PROBE_ROLE;
      url.password = probePassword;
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
            principalId,
            newUuidV7(),
            newUuidV7(),
            randomBytes(32),
            new Date(Date.now() + 60_000).toISOString(),
            ENTERPRISE_ID,
            [...allowedProjectIds],
            newUuidV7(),
          ],
        );
        await client.query(`SET LOCAL ROLE ${DISCOVERY_READER_ROLE}`);
        const rows = (
          await client.query(
            `SELECT id, principal_id, scope_kind, enterprise_id, project_id, capability_code
               FROM identity_policy.capability_grant ORDER BY id`,
          )
        ).rows;
        return { rows, client };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        await client.end().catch(() => undefined);
        throw error;
      }
    }

    async function closeReader(client: pg.Client): Promise<void> {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end().catch(() => undefined);
    }

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(
        `CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${probePassword}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE`,
      );
      await admin.query(
        `GRANT platform_context_establisher TO ${PROBE_ROLE} WITH INHERIT FALSE, SET TRUE`,
      );
      await admin.query(
        `GRANT ${DISCOVERY_READER_ROLE} TO ${PROBE_ROLE} WITH INHERIT FALSE, SET TRUE`,
      );

      appPool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
      db = createIdentityPolicyDatabase(appPool);
      repo = new IdentityPolicyRepository(crypto);

      principalA = newUuidV7();
      principalB = newUuidV7();
      // Platform roots are written under the owning app context.
      await withIdentityTransaction(db, contextFor(OPERATOR_ID), async (trx) => {
        await repo.insertPrincipal(trx, {
          id: principalA,
          principalKind: 'HUMAN',
          displayName: 'Consultant A',
          createdByPrincipalId: OPERATOR_ID,
          createdByActorSnapshotId: newUuidV7(),
        });
        await repo.insertPrincipal(trx, {
          id: principalB,
          principalKind: 'HUMAN',
          displayName: 'Consultant B',
          createdByPrincipalId: OPERATOR_ID,
          createdByActorSnapshotId: newUuidV7(),
        });
        await repo.insertPolicySnapshot(trx, {
          policySnapshotId: newUuidV7(),
          policySetVersion: `wi266-rls-${process.pid}-${Date.now()}`,
          policySchemaRefs: [],
          effectiveFrom: new Date(Date.now() - 60_000),
          contractVersion: '1.0',
          schemaRegistryVersion: 'im02-static-v1',
          policyDocument: { note: 'issue 266 controlled RLS fixture' },
          createdByPrincipalId: OPERATOR_ID,
          actorSnapshotId: newUuidV7(),
          sourceCommandId: newUuidV7(),
          dataClassification: 'INTERNAL',
        });
      });
      const snapshot = await withIdentityTransaction(db, contextFor(OPERATOR_ID), (trx) =>
        trx
          .selectFrom('identity_policy.policy_snapshot')
          .selectAll()
          .orderBy('created_at', 'desc')
          .limit(1)
          .executeTakeFirstOrThrow(),
      );
      policySnapshotId = snapshot.policy_snapshot_id;
      policySnapshotHash = snapshot.payload_hash;

      const grant = (principalId: string, projectId: string, id: string) => ({
        id,
        principalId,
        code: DISCOVERY_CAPABILITY_CODE,
        scopeKind: 'PROJECT' as const,
        enterpriseId: ENTERPRISE_ID,
        projectId,
        validFrom: new Date(Date.now() - 60_000),
        justification: 'issue 266 controlled RLS fixture',
        createdByPrincipalId: OPERATOR_ID,
        createdByActorSnapshotId: newUuidV7(),
        resourceSelectors: [
          {
            selectorType: 'OBJECT_TYPE',
            objectType: 'project.project',
            objectId: projectId,
            scope: { enterpriseId: ENTERPRISE_ID, projectId },
          },
        ],
        actions: [DISCOVERY_ACTION],
        grantPolicySnapshotId: policySnapshotId,
        grantPolicySnapshotHash: policySnapshotHash,
      });
      await withIdentityTransaction(
        db,
        contextFor(OPERATOR_ID, { projectIds: [PROJECT_A] }),
        async (trx) => {
          await repo.insertCapabilityGrant(trx, grant(principalA, PROJECT_A, newUuidV7()));
        },
      );
      await withIdentityTransaction(
        db,
        contextFor(OPERATOR_ID, { projectIds: [PROJECT_B] }),
        async (trx) => {
          await repo.insertCapabilityGrant(trx, grant(principalB, PROJECT_B, newUuidV7()));
        },
      );
    });

    afterAll(async () => {
      await admin
        .query(`REVOKE ${DISCOVERY_READER_ROLE} FROM ${PROBE_ROLE}`)
        .catch(() => undefined);
      await admin
        .query(`REVOKE platform_context_establisher FROM ${PROBE_ROLE}`)
        .catch(() => undefined);
      await admin.query(`DROP OWNED BY ${PROBE_ROLE}`).catch(() => undefined);
      await admin.query(`DROP ROLE IF EXISTS ${PROBE_ROLE}`).catch(() => undefined);
      await admin.end();
      await appPool.end();
    });

    it('reader role is a non-bypassing, no-login, read-only role', async () => {
      const role = (
        await admin.query<{ rolcanlogin: boolean; rolbypassrls: boolean; rolsuper: boolean }>(
          'SELECT rolcanlogin, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1',
          [DISCOVERY_READER_ROLE],
        )
      ).rows[0];
      expect(role).toBeDefined();
      expect(role?.rolcanlogin).toBe(false);
      expect(role?.rolbypassrls).toBe(false);
      expect(role?.rolsuper).toBe(false);
    });

    it('sees only the verified principal own candidate rows', async () => {
      const asA = await openAsReader(principalA, [PROJECT_A]);
      try {
        expect(asA.rows).toHaveLength(1);
        expect(asA.rows[0]?.principal_id).toBe(principalA);
        expect(asA.rows[0]?.project_id).toBe(PROJECT_A);
      } finally {
        await closeReader(asA.client);
      }
      const asB = await openAsReader(principalB, [PROJECT_B]);
      try {
        expect(asB.rows).toHaveLength(1);
        expect(asB.rows[0]?.principal_id).toBe(principalB);
        expect(asB.rows[0]?.project_id).toBe(PROJECT_B);
      } finally {
        await closeReader(asB.client);
      }
    });

    it('a verified principal without grants reads zero rows', async () => {
      const asNobody = await openAsReader(newUuidV7(), []);
      try {
        expect(asNobody.rows).toHaveLength(0);
      } finally {
        await closeReader(asNobody.client);
      }
    });

    it('without a trusted transaction context the reader sees zero rows', async () => {
      const url = new URL(databaseUrl ?? '');
      url.username = PROBE_ROLE;
      url.password = probePassword;
      const client = new pg.Client({ connectionString: url.toString() });
      await client.connect();
      try {
        await client.query(`SET ROLE ${DISCOVERY_READER_ROLE}`);
        const rows = (await client.query('SELECT id FROM identity_policy.capability_grant')).rows;
        expect(rows).toHaveLength(0);
      } finally {
        await client.end();
      }
    });

    it('cannot write, cannot read platform tables, cannot read other schemas', async () => {
      const asA = await openAsReader(principalA, [PROJECT_A]);
      const client = asA.client;
      try {
        // Each denial runs inside its own savepoint: a failed statement aborts
        // the transaction, so an unguarded second denial would report 25P02
        // instead of the real privilege error.
        const attempt = async (text: string, values: unknown[] = []) => {
          await client.query('SAVEPOINT denial');
          try {
            const result = await client.query(text, values);
            await client.query('RELEASE SAVEPOINT denial');
            return result;
          } catch (error) {
            await client.query('ROLLBACK TO SAVEPOINT denial');
            throw error;
          }
        };
        await expect(
          attempt(
            `UPDATE identity_policy.capability_grant SET justification = 'tamper' WHERE id = $1`,
            [asA.rows[0]?.id],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          attempt(
            `INSERT INTO identity_policy.capability_grant (id, principal_id, capability_code,
               scope_kind, enterprise_id, project_id, resource_selectors, actions, valid_from,
               grant_policy_snapshot_id, grant_policy_snapshot_hash, justification,
               created_by_principal_id, created_by_actor_snapshot_id)
             VALUES ($1,$2,'x','PROJECT',$3,$4,'[]','{}',now(),$5,$6,'x',$2,$2)`,
            [
              newUuidV7(),
              principalA,
              ENTERPRISE_ID,
              PROJECT_A,
              policySnapshotId,
              policySnapshotHash,
            ],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(attempt('DELETE FROM identity_policy.capability_grant')).rejects.toMatchObject(
          {
            code: '42501',
          },
        );
        for (const statement of [
          'SELECT id FROM identity_policy.principal',
          'SELECT id FROM identity_policy.external_identity_link',
          'SELECT policy_snapshot_id FROM identity_policy.policy_snapshot',
          'SELECT project_id FROM enterprise_project.project',
        ]) {
          await expect(attempt(statement)).rejects.toMatchObject({ code: '42501' });
        }
      } finally {
        await closeReader(client);
      }
    });

    it('the legacy app role is unaffected and still cannot see beyond its context', async () => {
      const asA = await withIdentityTransaction(
        db,
        contextFor(principalA, { projectIds: [PROJECT_A] }),
        (trx) => trx.selectFrom('identity_policy.capability_grant').selectAll().execute(),
      );
      expect(asA).toHaveLength(1);
      expect(asA[0]?.principal_id).toBe(principalA);
    });
  },
);
