import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  createIdentityPolicyDatabase,
  withIdentityTransaction,
  IdentityPolicyRepository,
  type IdentityCryptoPorts,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';

// IM-02 WI-05 (issue #33): the IdentityPolicy relational model (V1001) and
// the low-level repository are proven against the real PostgreSQL from the
// persistence gate, through a non-superuser runtime-role pool (RLS applies).
// Crypto ports use explicit TEST implementations (HMAC/AES-GCM with local
// test keys). Real OpenBao Transit stays NOT RUN and must never be claimed
// from these doubles.

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const ENTERPRISE_A = '12121212-1212-7121-8121-1212121212a1';
const ENTERPRISE_B = '23232323-2323-7232-8232-2323232323b2';
const PROJECT_A1 = '34343434-3434-7343-8343-3434343434c1';
const OPERATOR = '45454545-4545-7545-8545-4545454545e1';
const OPERATOR_ACTOR = '56565656-5656-7565-8565-5656565656f1';
const DECISION = '67676767-6767-7767-8767-6767676767a1';
const DECISION_HASH = Buffer.alloc(32, 0x5a);
const CORRELATION = '78787878-7878-7878-8878-7878787878b1';

const RAW_ACCOUNT = 'ou_raw-account+wi05@example.com';
const RAW_SUBJECT = 'om_raw-subject-wi05@example.com';

const HUMAN_PRINCIPAL = '89898989-8989-7898-8989-8989898989c1';
const AGENT_PRINCIPAL = '89898989-8989-7898-8989-8989898989c2';
const ROLE_ASSIGNMENT_A = '90909090-9090-7090-8090-9090909090d1';
const ROLE_ASSIGNMENT_B = '90909090-9090-7090-8090-9090909090d4';
const CAPABILITY_GRANT_A = '91919191-9191-7191-8191-9191919191e1';
const POLICY_SNAPSHOT_ID = '92929292-9292-7292-8292-9292929292f1';
const ACTOR_SNAPSHOT_ID = '93939393-9393-7393-8393-9393939393a1';
const DECISION_ID = '94949494-9494-7494-8494-9494949494b1';
const ACTOR_HASH_INPUT = Buffer.alloc(32, 0x11);
const CMD_HASH = Buffer.alloc(32, 0x22);

const CONTEXT_A: IdentityTransactionContext = {
  kind: 'REQUEST',
  principalId: OPERATOR,
  actorSnapshotId: OPERATOR_ACTOR,
  authorizationDecisionId: DECISION,
  authorizationDecisionHash: DECISION_HASH,
  authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  enterpriseId: ENTERPRISE_A,
  allowedProjectIds: [PROJECT_A1],
  correlationId: CORRELATION,
};

function testCryptoPorts(): IdentityCryptoPorts {
  const hmacKey = Buffer.alloc(32, 0x9c);
  const aesKey = Buffer.alloc(32, 0x7e);
  return {
    lookupHash: {
      computeKeyedLookupHash(normalizedInput: string) {
        return {
          hash: createHmac('sha256', hmacKey).update(normalizedInput, 'utf8').digest(),
          algorithm: 'HMAC-SHA-256' as const,
          keyVersion: 1,
        };
      },
    },
    fieldEncryption: {
      encryptField(plainText: string) {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
        const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return {
          ciphertext: Buffer.concat([iv, tag, encrypted]),
          algorithm: 'AES-256-GCM' as const,
          keyVersion: 1,
        };
      },
      decryptField(field: { ciphertext: Buffer }) {
        const iv = field.ciphertext.subarray(0, 12);
        const tag = field.ciphertext.subarray(12, 28);
        const encrypted = field.ciphertext.subarray(28);
        const decipher = createDecipheriv('aes-256-gcm', aesKey, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
      },
    },
  };
}

describe.skipIf(!gateEnabled)('identity policy model and repository (real PostgreSQL)', () => {
  let admin: pg.Client;
  let appPool: pg.Pool;
  let otherModule: pg.Client;
  let db: ReturnType<typeof createIdentityPolicyDatabase>;
  let repo: IdentityPolicyRepository;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `CREATE ROLE wi05_probe_ip LOGIN PASSWORD 'wi05-probe-ip' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(`GRANT identity_policy_app TO wi05_probe_ip`);
    await admin.query(
      `CREATE ROLE wi05_probe_ep LOGIN PASSWORD 'wi05-probe-ep' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(`GRANT enterprise_project_app TO wi05_probe_ep`);

    const url = new URL(databaseUrl ?? '');
    url.username = 'wi05_probe_ip';
    url.password = 'wi05-probe-ip';
    appPool = new pg.Pool({ connectionString: url.toString(), max: 2 });
    db = createIdentityPolicyDatabase(appPool);
    repo = new IdentityPolicyRepository(testCryptoPorts());

    const epUrl = new URL(databaseUrl ?? '');
    epUrl.username = 'wi05_probe_ep';
    epUrl.password = 'wi05-probe-ep';
    otherModule = new pg.Client({ connectionString: epUrl.toString() });
    await otherModule.connect();
  });

  afterAll(async () => {
    await appPool.end();
    await otherModule.end();
    await admin.end();
  });

  it('records the core model migration and the §9 table inventory with RLS', async () => {
    const history = await admin.query<{ description: string; success: boolean }>(
      `SELECT description, success FROM public.flyway_schema_history WHERE version = '1001'`,
    );
    expect(history.rows[0]?.description).toBe('identity policy core model');
    expect(history.rows[0]?.success).toBe(true);

    const expected = [
      'principal',
      'principal_state_transition',
      'external_identity_link',
      'role_assignment',
      'role_revocation',
      'capability_grant',
      'capability_revocation',
      'policy_snapshot',
      'actor_snapshot',
      'authorization_decision',
    ];
    for (const table of expected) {
      const result = await admin.query<{ owner: string; rls: boolean; force: boolean }>(
        `SELECT pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity AS rls,
                c.relforcerowsecurity AS force
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'identity_policy' AND c.relname = $1 AND c.relkind = 'r'`,
        [table],
      );
      expect(result.rows, table).toHaveLength(1);
      expect(result.rows[0]?.owner, table).toBe('identity_policy_owner');
      expect(result.rows[0]?.rls, table).toBe(true);
      expect(result.rows[0]?.force, table).toBe(true);
    }
  });

  it('makes snapshots and facts append-only for the app role', async () => {
    const immutable = [
      'principal_state_transition',
      'role_revocation',
      'capability_revocation',
      'policy_snapshot',
      'actor_snapshot',
      'authorization_decision',
    ];
    for (const table of immutable) {
      const update = await admin.query<{ can: boolean }>(
        `SELECT has_table_privilege('identity_policy_app', $1, 'UPDATE') AS can`,
        [`identity_policy.${table}`],
      );
      expect(update.rows[0]?.can, `${table} UPDATE`).toBe(false);
    }
    for (const table of [
      'principal',
      'external_identity_link',
      'role_assignment',
      'capability_grant',
    ]) {
      const update = await admin.query<{ can: boolean }>(
        `SELECT has_table_privilege('identity_policy_app', $1, 'UPDATE') AS can`,
        [`identity_policy.${table}`],
      );
      expect(update.rows[0]?.can, `${table} UPDATE`).toBe(true);
    }
  });

  it('creates principals, transitions and external identity links through the repository', async () => {
    await withIdentityTransaction(db, CONTEXT_A, async (trx) => {
      await repo.insertPrincipal(trx, {
        id: HUMAN_PRINCIPAL,
        principalKind: 'HUMAN',
        displayName: 'WI-05 Human Fixture',
        createdByPrincipalId: OPERATOR,
        createdByActorSnapshotId: OPERATOR_ACTOR,
      });
      await repo.insertPrincipal(trx, {
        id: AGENT_PRINCIPAL,
        principalKind: 'AGENT',
        displayName: 'WI-05 Agent Fixture',
        createdByPrincipalId: OPERATOR,
        createdByActorSnapshotId: OPERATOR_ACTOR,
      });
      await repo.insertPrincipalStateTransition(trx, {
        transitionId: 'a0a0a0a0-0000-7000-8000-000000000001',
        principalId: HUMAN_PRINCIPAL,
        fromStatus: 'ACTIVE',
        toStatus: 'ACTIVE',
        reasonCode: 'wi05.initial',
        actorSnapshotId: OPERATOR_ACTOR,
        sourceCommandId: 'a0a0a0a0-0000-7000-8000-000000000002',
      });
    });

    const principal = await withIdentityTransaction(db, CONTEXT_A, (trx) =>
      repo.getPrincipalById(trx, HUMAN_PRINCIPAL),
    );
    expect(principal?.principal_kind).toBe('HUMAN');
    expect(principal?.status).toBe('ACTIVE');

    await withIdentityTransaction(db, CONTEXT_A, async (trx) => {
      await repo.insertExternalIdentityLink(trx, {
        id: 'a1a1a1a1-0000-7000-8000-000000000001',
        providerCode: 'FEISHU',
        accountExternalId: RAW_ACCOUNT,
        subjectExternalId: RAW_SUBJECT,
        displayHint: 'feishu user (redacted)',
        principalId: HUMAN_PRINCIPAL,
        verifiedAt: new Date(),
        verificationMethod: 'wi05.manual-check',
        evidenceRefs: { kind: 'fixture' },
        createdByPrincipalId: OPERATOR,
        createdByActorSnapshotId: OPERATOR_ACTOR,
      });
    });

    const link = await withIdentityTransaction(db, CONTEXT_A, (trx) =>
      repo.findExternalIdentityLinkByLookup(trx, 'feishu', RAW_ACCOUNT, RAW_SUBJECT),
    );
    expect(link?.principalId).toBe(HUMAN_PRINCIPAL);
    expect(link?.status).toBe('ACTIVE');
    expect(link?.lookupHashAlgorithm).toBe('HMAC-SHA-256');
    // The safe view exposes only keyed hashes + ciphertext metadata.
    expect(JSON.stringify(link)).not.toContain(RAW_ACCOUNT);
    expect(JSON.stringify(link)).not.toContain(RAW_SUBJECT);
  });

  it('stores no raw external identifiers anywhere in the database row', async () => {
    const row = await admin.query<{
      row: unknown[];
    }>(
      `SELECT t::text FROM identity_policy.external_identity_link t
       WHERE principal_id = $1`,
      [HUMAN_PRINCIPAL],
    );
    const serialized = JSON.stringify(row.rows);
    expect(serialized).not.toContain(RAW_ACCOUNT);
    expect(serialized).not.toContain(RAW_SUBJECT);
    expect(serialized).not.toContain('example.com');
    // Sensitive denials keep only hashes/metadata: verify ciphertext exists.
    const ciphers = await admin.query<{ account: Buffer; subject: Buffer }>(
      `SELECT account_ciphertext AS account, subject_ciphertext AS subject
       FROM identity_policy.external_identity_link WHERE principal_id = $1`,
      [HUMAN_PRINCIPAL],
    );
    expect(ciphers.rows[0]?.account.length).toBeGreaterThan(28);
    expect(ciphers.rows[0]?.subject.length).toBeGreaterThan(28);
  });

  it('refuses a conflicting external identity mapping without overwriting the first', async () => {
    const inserted = await withIdentityTransaction(db, CONTEXT_A, async (trx) =>
      repo.insertExternalIdentityLink(trx, {
        id: 'a1a1a1a1-0000-7000-8000-000000000002',
        providerCode: 'feishu',
        accountExternalId: RAW_ACCOUNT,
        subjectExternalId: RAW_SUBJECT,
        principalId: AGENT_PRINCIPAL,
        verifiedAt: new Date(),
        verificationMethod: 'wi05.conflict',
        evidenceRefs: {},
        createdByPrincipalId: OPERATOR,
        createdByActorSnapshotId: OPERATOR_ACTOR,
      }),
    );
    expect(inserted).toBe(false);

    const link = await withIdentityTransaction(db, CONTEXT_A, (trx) =>
      repo.findExternalIdentityLinkByLookup(trx, 'feishu', RAW_ACCOUNT, RAW_SUBJECT),
    );
    expect(link?.principalId).toBe(HUMAN_PRINCIPAL);
    const count = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.external_identity_link
       WHERE principal_id IN ($1, $2)`,
      [HUMAN_PRINCIPAL, AGENT_PRINCIPAL],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('records and resolves policy snapshots, actor snapshots and decisions by exact id+hash', async () => {
    await withIdentityTransaction(db, CONTEXT_A, async (trx) => {
      await repo.insertPolicySnapshot(trx, {
        policySnapshotId: POLICY_SNAPSHOT_ID,
        policySetVersion: 'wi05-policy-set-1',
        policySchemaRefs: ['identity.PolicySnapshot@1.0'],
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        contractVersion: '1.0',
        schemaRegistryVersion: 'wi05-registry-1',
        policyDocument: { rules: ['allow-read'], version: 1 },
        createdByPrincipalId: OPERATOR,
        actorSnapshotId: OPERATOR_ACTOR,
        sourceCommandId: 'b1b1b1b1-0000-7000-8000-000000000001',
        dataClassification: 'INTERNAL',
      });
    });

    const policy = await withIdentityTransaction(db, CONTEXT_A, (trx) =>
      repo.getPolicySnapshotById(trx, POLICY_SNAPSHOT_ID),
    );
    if (!policy) {
      throw new Error('policy snapshot fixture missing');
    }
    const policyHash: Buffer = policy.payload_hash;
    expect(policy.policy_set_version).toBe('wi05-policy-set-1');
    const byHash = await withIdentityTransaction(db, CONTEXT_A, (trx) =>
      repo.getPolicySnapshotByIdAndHash(trx, POLICY_SNAPSHOT_ID, policyHash),
    );
    expect(byHash?.hashMatched).toBe(true);
    const wrongHash = await withIdentityTransaction(db, CONTEXT_A, (trx) =>
      repo.getPolicySnapshotByIdAndHash(trx, POLICY_SNAPSHOT_ID, Buffer.alloc(32, 0x01)),
    );
    expect(wrongHash?.hashMatched).toBe(false);

    await withIdentityTransaction(db, CONTEXT_A, async (trx) => {
      await repo.insertActorSnapshot(trx, {
        actorSnapshotId: ACTOR_SNAPSHOT_ID,
        principalId: HUMAN_PRINCIPAL,
        principalKind: 'HUMAN',
        authenticationContextHash: ACTOR_HASH_INPUT,
        enterpriseId: ENTERPRISE_A,
        contractVersion: '1.0',
        snapshotPayload: {
          note: 'wi05 human actor',
          principalKind: 'HUMAN',
          enterpriseId: ENTERPRISE_A,
        },
        createdByPrincipalId: OPERATOR,
        sourceCommandId: 'b1b1b1b1-0000-7000-8000-000000000002',
      });
    });

    // A wrong hash resolves the row but never reports a match: callers must
    // treat hashMatched=false as an integrity failure, not as a hit.
    const actor = await withIdentityTransaction(db, CONTEXT_A, (trx) =>
      repo.getActorSnapshotByIdAndHash(trx, ACTOR_SNAPSHOT_ID, Buffer.alloc(32, 0x00)),
    );
    expect(actor?.hashMatched).toBe(false);
    const actorByRow = await admin.query<{ payload_hash: Buffer }>(
      `SELECT payload_hash FROM identity_policy.actor_snapshot WHERE actor_snapshot_id = $1`,
      [ACTOR_SNAPSHOT_ID],
    );
    const actorRow = actorByRow.rows.at(0);
    if (!actorRow) {
      throw new Error('actor snapshot fixture missing');
    }
    const actorOk = await withIdentityTransaction(db, CONTEXT_A, (trx) =>
      repo.getActorSnapshotByIdAndHash(trx, ACTOR_SNAPSHOT_ID, actorRow.payload_hash),
    );
    expect(actorOk?.hashMatched).toBe(true);

    await withIdentityTransaction(db, CONTEXT_A, async (trx) => {
      await repo.insertAuthorizationDecision(trx, {
        authorizationDecisionId: DECISION_ID,
        actorSnapshotId: ACTOR_SNAPSHOT_ID,
        principalId: HUMAN_PRINCIPAL,
        principalKind: 'HUMAN',
        outcome: 'ALLOW',
        reasonCodes: ['wi05.policy-allow'],
        commandType: 'wi05.demo.command',
        commandVersion: '1.0',
        scopeKind: 'PROJECT',
        enterpriseId: ENTERPRISE_A,
        projectId: PROJECT_A1,
        purpose: 'wi05.test',
        requestedCapability: 'wi05.capability',
        commandPayloadHash: CMD_HASH,
        policySnapshotId: POLICY_SNAPSHOT_ID,
        policySnapshotPayloadHash: policyHash,
        authenticationContextHash: ACTOR_HASH_INPUT,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        contractVersion: '1.0',
        decisionPayload: {
          outcome: 'ALLOW',
          enterpriseId: ENTERPRISE_A,
          commandType: 'wi05.demo.command',
          note: 'wi05 decision body',
        },
        createdByPrincipalId: OPERATOR,
        sourceCommandId: 'b1b1b1b1-0000-7000-8000-000000000003',
      });
    });

    const decisionRow = await admin.query<{ payload_hash: Buffer }>(
      `SELECT payload_hash FROM identity_policy.authorization_decision
       WHERE authorization_decision_id = $1`,
      [DECISION_ID],
    );
    const decisionHashRow = decisionRow.rows.at(0);
    if (!decisionHashRow) {
      throw new Error('decision fixture missing');
    }
    const decision = await withIdentityTransaction(db, CONTEXT_A, (trx) =>
      repo.getAuthorizationDecisionByIdAndHash(trx, DECISION_ID, decisionHashRow.payload_hash),
    );
    expect(decision?.row.outcome).toBe('ALLOW');
    expect(decision?.hashMatched).toBe(true);
  });

  it('assigns roles, appends revocations and keeps history readable', async () => {
    const now = new Date();
    await withIdentityTransaction(db, CONTEXT_A, async (trx) => {
      await repo.insertRoleAssignment(trx, {
        id: ROLE_ASSIGNMENT_A,
        principalId: HUMAN_PRINCIPAL,
        code: 'wi05.qa-manager',
        scopeKind: 'ENTERPRISE',
        enterpriseId: ENTERPRISE_A,
        validFrom: now,
        justification: 'wi05 fixture',
        createdByPrincipalId: OPERATOR,
        createdByActorSnapshotId: OPERATOR_ACTOR,
      });
      // A short-lived assignment that is already expired at evaluation time.
      await repo.insertRoleAssignment(trx, {
        id: ROLE_ASSIGNMENT_B,
        principalId: HUMAN_PRINCIPAL,
        code: 'wi05.auditor',
        scopeKind: 'PROJECT',
        enterpriseId: ENTERPRISE_A,
        projectId: PROJECT_A1,
        validFrom: new Date(now.getTime() - 3600_000),
        validTo: new Date(now.getTime() - 1800_000),
        justification: 'wi05 expired fixture',
        createdByPrincipalId: OPERATOR,
        createdByActorSnapshotId: OPERATOR_ACTOR,
      });
    });

    const active = await withIdentityTransaction(db, CONTEXT_A, (trx) =>
      repo.listActiveRoleAssignments(trx, HUMAN_PRINCIPAL, ENTERPRISE_A, now),
    );
    expect(active.map((row) => row.role_code)).toEqual(['wi05.qa-manager']);

    // Duplicate active assignment for the same principal/role/scope is a
    // database-adjudicated rejection.
    await expect(
      withIdentityTransaction(db, CONTEXT_A, async (trx) => {
        await repo.insertRoleAssignment(trx, {
          id: 'b2b2b2b2-0000-7000-8000-000000000001',
          principalId: HUMAN_PRINCIPAL,
          code: 'wi05.qa-manager',
          scopeKind: 'ENTERPRISE',
          enterpriseId: ENTERPRISE_A,
          validFrom: now,
          justification: 'wi05 duplicate',
          createdByPrincipalId: OPERATOR,
          createdByActorSnapshotId: OPERATOR_ACTOR,
        });
      }),
    ).rejects.toMatchObject({ code: '23505' });

    await withIdentityTransaction(db, CONTEXT_A, async (trx) => {
      await repo.insertRoleRevocation(trx, {
        revocationId: 'b2b2b2b2-0000-7000-8000-000000000002',
        targetId: ROLE_ASSIGNMENT_A,
        enterpriseId: ENTERPRISE_A,
        revokedByPrincipalId: OPERATOR,
        reasonCode: 'wi05.rotate',
        effectiveAt: now,
        actorSnapshotId: OPERATOR_ACTOR,
        sourceCommandId: 'b2b2b2b2-0000-7000-8000-000000000003',
      });
      await repo.markRoleAssignmentRevoked(
        trx,
        ROLE_ASSIGNMENT_A,
        'b2b2b2b2-0000-7000-8000-000000000003',
      );
    });

    const afterRevoke = await withIdentityTransaction(db, CONTEXT_A, (trx) =>
      repo.listActiveRoleAssignments(trx, HUMAN_PRINCIPAL, ENTERPRISE_A, now),
    );
    expect(afterRevoke).toEqual([]);
    const history = await withIdentityTransaction(db, CONTEXT_A, (trx) =>
      repo.getRoleAssignmentById(trx, ROLE_ASSIGNMENT_A),
    );
    expect(history?.status).toBe('REVOKED');
    const revocation = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.role_revocation WHERE role_assignment_id = $1`,
      [ROLE_ASSIGNMENT_A],
    );
    expect(revocation.rows[0]?.count).toBe('1');
  });

  it('grants capabilities bound to an exact policy snapshot and revokes by fact', async () => {
    const policy = await withIdentityTransaction(db, CONTEXT_A, (trx) =>
      repo.getPolicySnapshotById(trx, POLICY_SNAPSHOT_ID),
    );
    if (!policy) {
      throw new Error('policy snapshot fixture missing');
    }
    const policyHash: Buffer = policy.payload_hash;
    const now = new Date();
    await withIdentityTransaction(db, CONTEXT_A, async (trx) => {
      await repo.insertCapabilityGrant(trx, {
        id: CAPABILITY_GRANT_A,
        principalId: HUMAN_PRINCIPAL,
        code: 'wi05.document.approve',
        scopeKind: 'PROJECT',
        enterpriseId: ENTERPRISE_A,
        projectId: PROJECT_A1,
        resourceSelectors: [{ type: 'Artifact', scope: 'project' }],
        actions: ['wi05.approve'],
        validFrom: now,
        justification: 'wi05 fixture',
        grantPolicySnapshotId: POLICY_SNAPSHOT_ID,
        grantPolicySnapshotHash: policyHash,
        createdByPrincipalId: OPERATOR,
        createdByActorSnapshotId: OPERATOR_ACTOR,
      });
    });

    const grants = await withIdentityTransaction(db, CONTEXT_A, (trx) =>
      repo.listActiveCapabilityGrants(trx, HUMAN_PRINCIPAL, ENTERPRISE_A, now),
    );
    expect(grants.map((row) => row.capability_code)).toEqual(['wi05.document.approve']);

    await expect(
      withIdentityTransaction(db, CONTEXT_A, async (trx) => {
        await repo.insertCapabilityGrant(trx, {
          id: 'b3b3b3b3-0000-7000-8000-000000000001',
          principalId: HUMAN_PRINCIPAL,
          code: 'wi05.document.approve',
          scopeKind: 'PROJECT',
          enterpriseId: ENTERPRISE_A,
          projectId: PROJECT_A1,
          resourceSelectors: [],
          actions: ['wi05.approve'],
          validFrom: now,
          justification: 'wi05 duplicate',
          grantPolicySnapshotId: POLICY_SNAPSHOT_ID,
          grantPolicySnapshotHash: policyHash,
          createdByPrincipalId: OPERATOR,
          createdByActorSnapshotId: OPERATOR_ACTOR,
        });
      }),
    ).rejects.toMatchObject({ code: '23505' });

    await withIdentityTransaction(db, CONTEXT_A, async (trx) => {
      await repo.insertCapabilityRevocation(trx, {
        revocationId: 'b3b3b3b3-0000-7000-8000-000000000002',
        targetId: CAPABILITY_GRANT_A,
        enterpriseId: ENTERPRISE_A,
        revokedByPrincipalId: OPERATOR,
        reasonCode: 'wi05.offboard',
        effectiveAt: now,
        actorSnapshotId: OPERATOR_ACTOR,
        sourceCommandId: 'b3b3b3b3-0000-7000-8000-000000000003',
      });
      await repo.markCapabilityGrantRevoked(
        trx,
        CAPABILITY_GRANT_A,
        'b3b3b3b3-0000-7000-8000-000000000003',
      );
    });
    const afterRevoke = await withIdentityTransaction(db, CONTEXT_A, (trx) =>
      repo.listActiveCapabilityGrants(trx, HUMAN_PRINCIPAL, ENTERPRISE_A, now),
    );
    expect(afterRevoke).toEqual([]);
  });

  it('rejects immutable-table UPDATE/DELETE, kind swaps and scope rewrites at the database', async () => {
    // Runtime role denials (RLS context not needed for permission checks).
    await admin.query(`SET ROLE identity_policy_app`);
    await expect(
      admin.query(`DELETE FROM identity_policy.authorization_decision`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      admin.query(`UPDATE identity_policy.actor_snapshot SET channel_code = 'x'`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      admin.query(`UPDATE identity_policy.policy_snapshot SET effective_from = now()`),
    ).rejects.toMatchObject({ code: '42501' });
    await admin.query(`RESET ROLE`);

    // Guard triggers: kind and scope are immutable even for the table owner.
    await expect(
      admin.query(`UPDATE identity_policy.principal SET principal_kind = 'AGENT' WHERE id = $1`, [
        HUMAN_PRINCIPAL,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      admin.query(`UPDATE identity_policy.role_assignment SET enterprise_id = $1 WHERE id = $2`, [
        ENTERPRISE_B,
        ROLE_ASSIGNMENT_B,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects promoted-mirror mismatches on snapshots and decisions at the database', async () => {
    const digest = Buffer.alloc(32, 0x33);
    await expect(
      admin.query(
        `INSERT INTO identity_policy.policy_snapshot (
           policy_snapshot_id, policy_set_version, policy_schema_refs, effective_from,
           contract_type, contract_version, schema_registry_version, canonicalization_version,
           payload_hash_algorithm, payload_hash, payload_size_bytes, canonical_payload,
           created_by_principal_id, actor_snapshot_id, source_command_id, data_classification,
           retention_class)
         VALUES ('c4c4c4c4-0000-7000-8000-000000000001', 'mirror-mismatch', '[]'::jsonb, now(),
                 'identity.PolicySnapshot', '1.0', 'r', '1', 'SHA-256', $1, 10,
                 '{"policySetVersion": "DIFFERENT"}'::jsonb,
                 $2, $2, $3, 'INTERNAL', 'REGULATED_AUDIT')`,
        [digest, OPERATOR, OPERATOR_ACTOR],
      ),
    ).rejects.toMatchObject({ code: '22023' });

    await expect(
      admin.query(
        `INSERT INTO identity_policy.authorization_decision (
           authorization_decision_id, actor_snapshot_id, principal_id, principal_kind, outcome,
           reason_codes, command_type, command_version, scope_kind, enterprise_id, purpose,
           requested_capability, command_payload_hash, policy_snapshot_id,
           policy_snapshot_payload_hash, authentication_context_hash, expires_at,
           contract_type, contract_version, canonicalization_version, payload_hash_algorithm,
           payload_hash, payload_size_bytes, canonical_payload, created_by_principal_id,
           source_command_id, retention_class)
         VALUES ('c4c4c4c4-0000-7000-8000-000000000002', $1, $2, 'HUMAN', 'DENY', '{r}',
                 'wi05.cmd', '1.0', 'ENTERPRISE', $3, 'p', 'c', $4, $5, $4, $4, now() + interval '1 hour',
                 'identity.AuthorizationDecision', '1.0', '1', 'SHA-256', $4, 10,
                 '{"outcome": "ALLOW", "enterpriseId": "x", "commandType": "wi05.cmd"}'::jsonb,
                 $2, $3, 'REGULATED_AUDIT')`,
        [ACTOR_SNAPSHOT_ID, HUMAN_PRINCIPAL, ENTERPRISE_A, digest, POLICY_SNAPSHOT_ID],
      ),
    ).rejects.toMatchObject({ code: '22023' });
  });

  it('keeps enterprise-scoped rows invisible across enterprises under RLS', async () => {
    const contextB: IdentityTransactionContext = {
      ...CONTEXT_A,
      enterpriseId: ENTERPRISE_B,
      allowedProjectIds: [],
    };
    // Enterprise B context: the A-scoped role assignment and decision rows
    // simply do not exist (zero rows, no existence leak).
    const inB = await withIdentityTransaction(db, contextB, async (trx) => {
      const roles = await trx.selectFrom('identity_policy.role_assignment').selectAll().execute();
      const decisions = await trx
        .selectFrom('identity_policy.authorization_decision')
        .selectAll()
        .execute();
      const actors = await trx.selectFrom('identity_policy.actor_snapshot').selectAll().execute();
      return { roles, decisions, actors };
    });
    expect(inB.roles).toEqual([]);
    expect(inB.decisions).toEqual([]);
    expect(inB.actors).toEqual([]);

    // Writing an enterprise-B row while the payload claims enterprise A is
    // rejected by the RLS WITH CHECK.
    await expect(
      withIdentityTransaction(db, contextB, async (trx) => {
        await trx
          .insertInto('identity_policy.role_assignment')
          .values({
            id: 'c5c5c5c5-0000-7000-8000-000000000001',
            principal_id: HUMAN_PRINCIPAL,
            role_code: 'wi05.cross',
            scope_kind: 'ENTERPRISE',
            enterprise_id: ENTERPRISE_A,
            valid_from: new Date(),
            justification: 'wi05 cross-scope',
            created_by_principal_id: OPERATOR,
            created_by_actor_snapshot_id: OPERATOR_ACTOR,
          })
          .execute();
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('denies other module runtime roles direct reads of identity authoritative tables', async () => {
    await expect(
      otherModule.query(`SELECT count(*) FROM identity_policy.authorization_decision`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      otherModule.query(`SELECT count(*) FROM identity_policy.role_assignment`),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
