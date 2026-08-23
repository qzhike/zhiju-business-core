import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  assignRole,
  bootstrapMinimalAdminRole,
  createBootstrapClaim,
  createIdentityPolicyDatabase,
  grantCapability,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  IDENTITY_BOOTSTRAP_ROLE_INVALID,
  IDENTITY_CAPABILITY_ALREADY_ACTIVE,
  IDENTITY_CAPABILITY_HUMAN_ONLY,
  IDENTITY_CAPABILITY_NOT_ACTIVE,
  IDENTITY_CAPABILITY_SCOPE_INVALID,
  IDENTITY_POLICY_SNAPSHOT_INVALID,
  IDENTITY_POLICY_VERSION_UNKNOWN,
  IDENTITY_ROLE_ALREADY_ACTIVE,
  IDENTITY_ROLE_NOT_ACTIVE,
  IDENTITY_ROLE_SCOPE_INVALID,
  recordPolicySnapshot,
  revokeCapability,
  revokeRole,
  withIdentityTransaction,
  IdentityPolicyRepository,
  type IdentityCryptoPorts,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';
import { createHmac } from 'node:crypto';

// IM-02 WI-08 (issue #36): the five role/capability/policy command handlers
// on real PostgreSQL: duplicate-active rejections, the static Human-only
// registry, scope/period/policy-ref validation, expected-version revocation
// with appended facts, the audited first-role bootstrap that permanently
// closes the claim, and event redaction (IP-API-U-003 / IP-API-C-002).

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const ENTERPRISE_A = '9a9a9a9a-9a9a-79a9-89a9-9a9a9a9a9aa1';
const ENTERPRISE_B = '9b9b9b9b-9b9b-79b9-89b9-9b9b9b9b9bb2';
const PROJECT_A1 = '9c9c9c9c-9c9c-79c9-89c9-9c9c9c9c9cc1';
const PROJECT_A2 = '9c9c9c9c-9c9c-79c9-89c9-9c9c9c9c9cc2';
const OPERATOR = '9d9d9d9d-9d9d-79d9-89d9-9d9d9d9d9dd1';
const OPERATOR_ACTOR = '9e9e9e9e-9e9e-79e9-89e9-9e9e9e9e9ee1';
const DECISION = '9f9f9f9f-9f9f-79f9-89f9-9f9f9f9f9ff1';
const DECISION_HASH = Buffer.alloc(32, 0x81);
const CORRELATION = 'a0a0a0a0-a0a0-70a0-80a0-a0a0a0a0a001';

const HUMAN = 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a111';
const AGENT = 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a122';
const POLICY_ID = 'a2a2a2a2-a2a2-72a2-82a2-a2a2a2a2a222';

const crypto: IdentityCryptoPorts = {
  lookupHash: {
    computeKeyedLookupHash(input: string) {
      return {
        hash: createHmac('sha256', Buffer.alloc(32, 0x9c)).update(input, 'utf8').digest(),
        algorithm: 'HMAC-SHA-256' as const,
        keyVersion: 1,
      };
    },
  },
  fieldEncryption: {
    encryptField() {
      throw new Error('not needed');
    },
    decryptField() {
      throw new Error('not needed');
    },
  },
};

describe.skipIf(!gateEnabled)(
  'role, capability and policy snapshot handlers (real PostgreSQL)',
  () => {
    let admin: pg.Client;
    let pool: pg.Pool;
    let db: ReturnType<typeof createIdentityPolicyDatabase>;
    let repo: IdentityPolicyRepository;
    let context: IdentityTransactionContext;
    let policyHash: Buffer;
    let assignmentId: string;

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(
        `CREATE ROLE wi08_probe_ip LOGIN PASSWORD 'wi08-probe-ip' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      await admin.query(`GRANT identity_policy_app TO wi08_probe_ip`);
      const url = new URL(databaseUrl ?? '');
      url.username = 'wi08_probe_ip';
      url.password = 'wi08-probe-ip';
      pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
      db = createIdentityPolicyDatabase(pool);
      repo = new IdentityPolicyRepository(crypto);
      context = {
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
      const deps = { db, repo, crypto, context };

      // Fixture principals straight through the repository (the bootstrap
      // claim semantics belong to the register handler, not these tests).
      for (const [id, kind] of [
        [HUMAN, 'HUMAN'],
        [AGENT, 'AGENT'],
      ] as const) {
        await withIdentityTransaction(db, context, async (trx) => {
          await repo.insertPrincipal(trx, {
            id,
            principalKind: kind,
            displayName: `WI-08 ${kind} fixture`,
            createdByPrincipalId: OPERATOR,
            createdByActorSnapshotId: OPERATOR_ACTOR,
          });
        });
      }

      const policy = await recordPolicySnapshot(deps, {
        policySnapshotId: POLICY_ID,
        policySetVersion: 'wi08-policy-set-1',
        policySchemaRefs: ['identity.PolicySnapshot@1.0', 'identity.CapabilityPolicy@1.0'],
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        policyDocument: { rules: ['demo'], version: 1 },
        idempotencyKey: 'wi08:policy:1',
      });
      expect(policy).toMatchObject({ status: 'COMMITTED' });
      const hashRow = await admin.query<{ payload_hash: Buffer }>(
        `SELECT payload_hash FROM identity_policy.policy_snapshot WHERE policy_snapshot_id = $1`,
        [POLICY_ID],
      );
      const hash = hashRow.rows.at(0);
      if (!hash) {
        throw new Error('policy snapshot fixture missing');
      }
      policyHash = hash.payload_hash;
    });

    afterAll(async () => {
      await pool.end();
      await admin.end();
    });

    const deps = () => ({ db, repo, crypto, context });

    it('validates policy snapshot schema refs and set-version uniqueness', async () => {
      const unknown = await recordPolicySnapshot(deps(), {
        policySnapshotId: 'b1b1b1b1-b1b1-71b1-81b1-b1b1b1b1b111',
        policySetVersion: 'wi08-policy-set-unknown',
        policySchemaRefs: ['identity.UnknownPolicy@9.0'],
        effectiveFrom: new Date(),
        policyDocument: {},
        idempotencyKey: 'wi08:policy:unknown-ref',
      });
      expect(unknown).toMatchObject({
        status: 'REJECTED',
        errorCode: IDENTITY_POLICY_VERSION_UNKNOWN,
      });

      const duplicateVersion = await recordPolicySnapshot(deps(), {
        policySnapshotId: 'b1b1b1b1-b1b1-71b1-81b1-b1b1b1b1b112',
        policySetVersion: 'wi08-policy-set-1',
        policySchemaRefs: ['identity.PolicySnapshot@1.0'],
        effectiveFrom: new Date(),
        policyDocument: { other: true },
        idempotencyKey: 'wi08:policy:dup-version',
      });
      expect(duplicateVersion).toMatchObject({
        status: 'REJECTED',
        errorCode: IDENTITY_POLICY_SNAPSHOT_INVALID,
      });

      // Snapshot replay is idempotent and never re-records.
      const replay = await recordPolicySnapshot(deps(), {
        policySnapshotId: POLICY_ID,
        policySetVersion: 'wi08-policy-set-1',
        policySchemaRefs: ['identity.PolicySnapshot@1.0', 'identity.CapabilityPolicy@1.0'],
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        policyDocument: { rules: ['demo'], version: 1 },
        idempotencyKey: 'wi08:policy:1',
      });
      expect(replay).toMatchObject({ status: 'DUPLICATE', originalOutcome: 'COMMITTED' });
    });

    it('assigns roles with exact scope and rejects duplicates/invalid scopes deterministically', async () => {
      assignmentId = 'b2b2b2b2-b2b2-72b2-82b2-b2b2b2b2b211';
      const first = await assignRole(deps(), {
        assignmentId,
        principalId: HUMAN,
        roleCode: 'wi08.qa-manager',
        scope: { scopeKind: 'ENTERPRISE', enterpriseId: ENTERPRISE_A },
        validFrom: new Date(),
        justification: 'wi08 fixture',
        idempotencyKey: 'wi08:assign:1',
      });
      expect(first).toMatchObject({ status: 'COMMITTED' });

      const duplicate = await assignRole(deps(), {
        assignmentId: 'b2b2b2b2-b2b2-72b2-82b2-b2b2b2b2b212',
        principalId: HUMAN,
        roleCode: 'wi08.qa-manager',
        scope: { scopeKind: 'ENTERPRISE', enterpriseId: ENTERPRISE_A },
        validFrom: new Date(),
        justification: 'wi08 duplicate',
        idempotencyKey: 'wi08:assign:2',
      });
      expect(duplicate).toMatchObject({
        status: 'REJECTED',
        errorCode: IDENTITY_ROLE_ALREADY_ACTIVE,
      });

      const crossEnterprise = await assignRole(deps(), {
        assignmentId: 'b2b2b2b2-b2b2-72b2-82b2-b2b2b2b2b213',
        principalId: HUMAN,
        roleCode: 'wi08.other-role',
        scope: { scopeKind: 'ENTERPRISE', enterpriseId: ENTERPRISE_B },
        validFrom: new Date(),
        justification: 'cross enterprise',
        idempotencyKey: 'wi08:assign:3',
      });
      expect(crossEnterprise).toMatchObject({
        status: 'REJECTED',
        errorCode: IDENTITY_ROLE_SCOPE_INVALID,
      });

      const projectNotAllowed = await assignRole(deps(), {
        assignmentId: 'b2b2b2b2-b2b2-72b2-82b2-b2b2b2b2b214',
        principalId: HUMAN,
        roleCode: 'wi08.project-role',
        scope: { scopeKind: 'PROJECT', enterpriseId: ENTERPRISE_A, projectId: PROJECT_A2 },
        validFrom: new Date(),
        justification: 'project not in allowed scope',
        idempotencyKey: 'wi08:assign:4',
      });
      expect(projectNotAllowed).toMatchObject({
        status: 'REJECTED',
        errorCode: IDENTITY_ROLE_SCOPE_INVALID,
      });

      const allowedProject = await assignRole(deps(), {
        assignmentId: 'b2b2b2b2-b2b2-72b2-82b2-b2b2b2b2b215',
        principalId: HUMAN,
        roleCode: 'wi08.project-role',
        scope: { scopeKind: 'PROJECT', enterpriseId: ENTERPRISE_A, projectId: PROJECT_A1 },
        validFrom: new Date(),
        justification: 'project in allowed scope',
        idempotencyKey: 'wi08:assign:5',
      });
      expect(allowedProject).toMatchObject({ status: 'COMMITTED' });

      const badPeriod = await assignRole(deps(), {
        assignmentId: 'b2b2b2b2-b2b2-72b2-82b2-b2b2b2b2b216',
        principalId: HUMAN,
        roleCode: 'wi08.period-role',
        scope: { scopeKind: 'ENTERPRISE', enterpriseId: ENTERPRISE_A },
        validFrom: new Date(Date.now() + 3_600_000),
        validTo: new Date(),
        justification: 'inverted period',
        idempotencyKey: 'wi08:assign:6',
      });
      expect(badPeriod).toMatchObject({
        status: 'REJECTED',
        errorCode: IDENTITY_ROLE_SCOPE_INVALID,
      });

      // Same idempotency key with a different payload: conflict + audit,
      // original assignment untouched (IP-API-C-002).
      await expect(
        assignRole(deps(), {
          assignmentId,
          principalId: HUMAN,
          roleCode: 'wi08.qa-manager',
          scope: { scopeKind: 'ENTERPRISE', enterpriseId: ENTERPRISE_A },
          validFrom: new Date(),
          justification: 'TAMPERED justification',
          idempotencyKey: 'wi08:assign:1',
        }),
      ).rejects.toMatchObject({ code: IDEMPOTENCY_PAYLOAD_CONFLICT });
      const denialAudit = await admin.query<{ count: string }>(
        `SELECT count(*) AS count FROM identity_policy.audit_record
       WHERE outcome = 'DENIED' AND error_code = $1`,
        [IDEMPOTENCY_PAYLOAD_CONFLICT],
      );
      expect(Number(denialAudit.rows[0]?.count)).toBeGreaterThanOrEqual(1);
    });

    it('grants capabilities from the exact policy snapshot and enforces the human-only registry', async () => {
      const humanGrant = await grantCapability(deps(), {
        grantId: 'b3b3b3b3-b3b3-73b3-83b3-b3b3b3b3b311',
        principalId: HUMAN,
        capabilityCode: 'wi08.document.review',
        scope: { scopeKind: 'PROJECT', enterpriseId: ENTERPRISE_A, projectId: PROJECT_A1 },
        resourceSelectors: [{ type: 'Artifact' }],
        actions: ['wi08.review'],
        validFrom: new Date(),
        grantPolicySnapshotId: POLICY_ID,
        grantPolicySnapshotHash: policyHash,
        justification: 'wi08 fixture grant',
        idempotencyKey: 'wi08:grant:human',
      });
      expect(humanGrant).toMatchObject({ status: 'COMMITTED' });

      // Human-only capability to a HUMAN is fine.
      const humanOnlyForHuman = await grantCapability(deps(), {
        grantId: 'b3b3b3b3-b3b3-73b3-83b3-b3b3b3b3b312',
        principalId: HUMAN,
        capabilityCode: 'release.authorize',
        scope: { scopeKind: 'ENTERPRISE', enterpriseId: ENTERPRISE_A },
        resourceSelectors: [],
        actions: ['wi08.authorize'],
        validFrom: new Date(),
        grantPolicySnapshotId: POLICY_ID,
        grantPolicySnapshotHash: policyHash,
        justification: 'human-only for human',
        idempotencyKey: 'wi08:grant:human-only',
      });
      expect(humanOnlyForHuman).toMatchObject({ status: 'COMMITTED' });

      // AGENT can never receive a human-only capability; the kind stays AGENT.
      const agentHumanOnly = await grantCapability(deps(), {
        grantId: 'b3b3b3b3-b3b3-73b3-83b3-b3b3b3b3b313',
        principalId: AGENT,
        capabilityCode: 'release.authorize',
        scope: { scopeKind: 'ENTERPRISE', enterpriseId: ENTERPRISE_A },
        resourceSelectors: [],
        actions: ['wi08.authorize'],
        validFrom: new Date(),
        grantPolicySnapshotId: POLICY_ID,
        grantPolicySnapshotHash: policyHash,
        justification: 'agent attempts human-only',
        idempotencyKey: 'wi08:grant:agent-human-only',
      });
      expect(agentHumanOnly).toMatchObject({
        status: 'REJECTED',
        errorCode: IDENTITY_CAPABILITY_HUMAN_ONLY,
      });
      expect((agentHumanOnly as { safeSummary?: string }).safeSummary).toContain('AGENT');

      const duplicate = await grantCapability(deps(), {
        grantId: 'b3b3b3b3-b3b3-73b3-83b3-b3b3b3b3b314',
        principalId: HUMAN,
        capabilityCode: 'wi08.document.review',
        scope: { scopeKind: 'PROJECT', enterpriseId: ENTERPRISE_A, projectId: PROJECT_A1 },
        resourceSelectors: [],
        actions: ['wi08.review'],
        validFrom: new Date(),
        grantPolicySnapshotId: POLICY_ID,
        grantPolicySnapshotHash: policyHash,
        justification: 'duplicate grant',
        idempotencyKey: 'wi08:grant:duplicate',
      });
      expect(duplicate).toMatchObject({
        status: 'REJECTED',
        errorCode: IDENTITY_CAPABILITY_ALREADY_ACTIVE,
      });

      const wrongPolicyHash = await grantCapability(deps(), {
        grantId: 'b3b3b3b3-b3b3-73b3-83b3-b3b3b3b3b315',
        principalId: HUMAN,
        capabilityCode: 'wi08.other.capability',
        scope: { scopeKind: 'ENTERPRISE', enterpriseId: ENTERPRISE_A },
        resourceSelectors: [],
        actions: ['wi08.act'],
        validFrom: new Date(),
        grantPolicySnapshotId: POLICY_ID,
        grantPolicySnapshotHash: Buffer.alloc(32, 0x00),
        justification: 'wrong policy hash',
        idempotencyKey: 'wi08:grant:wrong-hash',
      });
      expect(wrongPolicyHash).toMatchObject({
        status: 'REJECTED',
        errorCode: IDENTITY_POLICY_VERSION_UNKNOWN,
      });

      const invalidScope = await grantCapability(deps(), {
        grantId: 'b3b3b3b3-b3b3-73b3-83b3-b3b3b3b3b316',
        principalId: HUMAN,
        capabilityCode: 'wi08.scoped.capability',
        scope: { scopeKind: 'PROJECT', enterpriseId: ENTERPRISE_A, projectId: PROJECT_A2 },
        resourceSelectors: [],
        actions: ['wi08.act'],
        validFrom: new Date(),
        grantPolicySnapshotId: POLICY_ID,
        grantPolicySnapshotHash: policyHash,
        justification: 'project outside scope',
        idempotencyKey: 'wi08:grant:bad-scope',
      });
      expect(invalidScope).toMatchObject({
        status: 'REJECTED',
        errorCode: IDENTITY_CAPABILITY_SCOPE_INVALID,
      });
    });

    it('revokes by expected version, appends facts and keeps history readable (IP-API-U-003)', async () => {
      const wrongVersion = await revokeRole(deps(), {
        targetId: assignmentId,
        expectedAggregateVersion: '42',
        revokedByPrincipalId: OPERATOR,
        reasonCode: 'wi08.rotate',
        effectiveAt: new Date(),
        idempotencyKey: 'wi08:revoke:wrong-version',
      });
      expect(wrongVersion).toMatchObject({
        status: 'REJECTED',
        errorCode: IDENTITY_ROLE_NOT_ACTIVE,
      });

      const revoked = await revokeRole(deps(), {
        targetId: assignmentId,
        expectedAggregateVersion: '1',
        revokedByPrincipalId: OPERATOR,
        reasonCode: 'wi08.rotate',
        effectiveAt: new Date(),
        idempotencyKey: 'wi08:revoke:1',
      });
      expect(revoked).toMatchObject({ status: 'COMMITTED' });

      // History: the assignment row is still readable, now REVOKED with an
      // appended revocation fact; a re-revoke is rejected.
      const row = await admin.query<{ status: string; aggregate_version: string }>(
        `SELECT status, aggregate_version::text FROM identity_policy.role_assignment WHERE id = $1`,
        [assignmentId],
      );
      expect(row.rows[0]).toEqual({ status: 'REVOKED', aggregate_version: '2' });
      const facts = await admin.query<{ count: string }>(
        `SELECT count(*) AS count FROM identity_policy.role_revocation WHERE role_assignment_id = $1`,
        [assignmentId],
      );
      expect(facts.rows[0]?.count).toBe('1');

      const reRevoke = await revokeRole(deps(), {
        targetId: assignmentId,
        expectedAggregateVersion: '2',
        revokedByPrincipalId: OPERATOR,
        reasonCode: 'wi08.re-revoke',
        effectiveAt: new Date(),
        idempotencyKey: 'wi08:revoke:2',
      });
      expect(reRevoke).toMatchObject({ status: 'REJECTED', errorCode: IDENTITY_ROLE_NOT_ACTIVE });

      // After revocation the same tuple may be assigned again.
      const reAssign = await assignRole(deps(), {
        assignmentId: 'b4b4b4b4-b4b4-74b4-84b4-b4b4b4b4b411',
        principalId: HUMAN,
        roleCode: 'wi08.qa-manager',
        scope: { scopeKind: 'ENTERPRISE', enterpriseId: ENTERPRISE_A },
        validFrom: new Date(),
        justification: 're-assign after revoke',
        idempotencyKey: 'wi08:assign:re-assign',
      });
      expect(reAssign).toMatchObject({ status: 'COMMITTED' });

      // Capability revocation mirrors the same guarantees.
      const grantRevoked = await revokeCapability(deps(), {
        targetId: 'b3b3b3b3-b3b3-73b3-83b3-b3b3b3b3b311',
        expectedAggregateVersion: '1',
        revokedByPrincipalId: OPERATOR,
        reasonCode: 'wi08.offboard',
        effectiveAt: new Date(),
        idempotencyKey: 'wi08:revoke-capability:1',
      });
      expect(grantRevoked).toMatchObject({ status: 'COMMITTED' });
      const grantRow = await admin.query<{ status: string }>(
        `SELECT status FROM identity_policy.capability_grant WHERE id = 'b3b3b3b3-b3b3-73b3-83b3-b3b3b3b3b311'`,
      );
      expect(grantRow.rows[0]?.status).toBe('REVOKED');
      const reRevokeGrant = await revokeCapability(deps(), {
        targetId: 'b3b3b3b3-b3b3-73b3-83b3-b3b3b3b3b311',
        expectedAggregateVersion: '2',
        revokedByPrincipalId: OPERATOR,
        reasonCode: 'wi08.re-revoke',
        effectiveAt: new Date(),
        idempotencyKey: 'wi08:revoke-capability:2',
      });
      expect(reRevokeGrant).toMatchObject({
        status: 'REJECTED',
        errorCode: IDENTITY_CAPABILITY_NOT_ACTIVE,
      });
    });

    it('bootstraps the first admin role and permanently closes the bootstrap claim', async () => {
      const claim = await createBootstrapClaim(deps(), {
        purpose: 'FIRST_ADMIN_ROLE',
        operatorDescription: 'wi08 operator fixture',
        operatorActorSnapshotId: OPERATOR_ACTOR,
        operatorAuthorizationDecisionId: DECISION,
        reason: 'first admin role bootstrap fixture',
        evidenceRefs: { ticket: 'WI-08' },
        expiresAt: new Date(Date.now() + 3_600_000),
      });

      const bootstrapped = await bootstrapMinimalAdminRole(deps(), {
        bootstrapClaimId: claim.claimId,
        assignmentId: 'b5b5b5b5-b5b5-75b5-85b5-b5b5b5b5b511',
        principalId: HUMAN,
        roleCode: 'wi08.platform-admin',
        justification: 'first admin role',
        idempotencyKey: 'wi08:bootstrap-role:1',
      });
      expect(bootstrapped).toMatchObject({ status: 'COMMITTED' });

      const claimRow = await admin.query<{
        consumed_at: Date | null;
        closed_at: Date | null;
        closed_reason: string | null;
      }>(
        `SELECT consumed_at, closed_at, closed_reason FROM identity_policy.bootstrap_claim WHERE claim_id = $1`,
        [claim.claimId],
      );
      expect(claimRow.rows[0]?.consumed_at).not.toBeNull();
      expect(claimRow.rows[0]?.closed_at).not.toBeNull();
      expect(claimRow.rows[0]?.closed_reason).toContain('permanently closed');

      // Replay is idempotent and does not resurrect anything.
      const replay = await bootstrapMinimalAdminRole(deps(), {
        bootstrapClaimId: claim.claimId,
        assignmentId: 'b5b5b5b5-b5b5-75b5-85b5-b5b5b5b5b511',
        principalId: HUMAN,
        roleCode: 'wi08.platform-admin',
        justification: 'first admin role',
        idempotencyKey: 'wi08:bootstrap-role:1',
      });
      expect(replay).toMatchObject({ status: 'DUPLICATE', originalOutcome: 'COMMITTED' });

      // Any further bootstrap execution is rejected after the close.
      const again = await bootstrapMinimalAdminRole(deps(), {
        bootstrapClaimId: claim.claimId,
        assignmentId: 'b5b5b5b5-b5b5-75b5-85b5-b5b5b5b5b512',
        principalId: AGENT,
        roleCode: 'wi08.platform-admin',
        justification: 'attempt after close',
        idempotencyKey: 'wi08:bootstrap-role:2',
      });
      expect(again).toMatchObject({
        status: 'REJECTED',
        errorCode: IDENTITY_BOOTSTRAP_ROLE_INVALID,
      });

      // Normal authorization keeps flowing through the ordinary command.
      const normal = await assignRole(deps(), {
        assignmentId: 'b5b5b5b5-b5b5-75b5-85b5-b5b5b5b5b513',
        principalId: AGENT,
        roleCode: 'wi08.runner',
        scope: { scopeKind: 'ENTERPRISE', enterpriseId: ENTERPRISE_A },
        validFrom: new Date(),
        justification: 'normal command after bootstrap close',
        idempotencyKey: 'wi08:assign:after-close',
      });
      expect(normal).toMatchObject({ status: 'COMMITTED' });
    });

    it('never leaks constraint bodies or capability tokens through public events', async () => {
      const events = await admin.query<{ event_type: string; payload: string }>(
        `SELECT event_type, payload::text AS payload FROM identity_policy.outbox_event
       WHERE event_type IN ('identity.RoleAssigned', 'identity.RoleRevoked',
                            'identity.CapabilityGranted', 'identity.CapabilityRevoked',
                            'identity.PolicySnapshotRecorded')`,
      );
      expect(events.rows.length).toBeGreaterThanOrEqual(5);
      for (const row of events.rows) {
        expect(row.payload, row.event_type).not.toContain('constraints');
        expect(row.payload, row.event_type).not.toContain('resourceSelectors');
        expect(row.payload, row.event_type).not.toContain('token');
        expect(row.payload, row.event_type).not.toContain('justification');
      }
    });
  },
);
