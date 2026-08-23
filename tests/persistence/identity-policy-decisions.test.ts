import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  authorizeCommand,
  checkEnterpriseAccess,
  checkHumanOnlyCapability,
  checkProjectAccess,
  createActorSnapshot,
  createIdentityPolicyDatabase,
  getPolicySnapshot,
  grantCapability,
  IDENTITY_ACTOR_SNAPSHOT_INVALID,
  IDENTITY_POLICY_SNAPSHOT_HASH_MISMATCH,
  IDENTITY_POLICY_SNAPSHOT_NOT_FOUND,
  recordPolicySnapshot,
  revokeCapability,
  SnapshotBoundaryError,
  validateAuthorizationDecision,
  withIdentityTransaction,
  IdentityPolicyRepository,
  type IdentityCryptoPorts,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';

// IM-02 WI-09 (issue #37): the Decision Port and the access/policy queries
// on real PostgreSQL: immutable ALLOW/DENY decisions bound to the exact
// actor snapshot / intent / policy snapshot, actingFor never upgrades the
// actor kind, cross-project DENY without existence leaks, decision
// validation rejecting any mismatch, and revocation turning new decisions
// into DENY while history stays readable (IP-API-U-001 / IP-U-004).

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const ENTERPRISE_A = 'b0b0b0b0-b0b0-70b0-80b0-b0b0b0b0b0a1';
const PROJECT_A1 = 'b1b1b1b1-b1b1-71b1-81b1-b1b1b1b1b1c1';
const PROJECT_A2 = 'b1b1b1b1-b1b1-71b1-81b1-b1b1b1b1b1c2';
const OPERATOR = 'b2b2b2b2-b2b2-72b2-82b2-b2b2b2b2b2d1';
const OPERATOR_ACTOR = 'b3b3b3b3-b3b3-73b3-83b3-b3b3b3b3b3e1';
const DECISION = 'b4b4b4b4-b4b4-74b4-84b4-b4b4b4b4b4f1';
const DECISION_HASH = Buffer.alloc(32, 0x91);
const CORRELATION = 'b5b5b5b5-b5b5-75b5-85b5-b5b5b5b5b501';

const HUMAN = 'b6b6b6b6-b6b6-76b6-86b6-b6b6b6b6b611';
const AGENT = 'b6b6b6b6-b6b6-76b6-86b6-b6b6b6b6b622';
const POLICY_ID = 'b7b7b7b7-b7b7-77b7-87b7-b7b7b7b7b722';
const CMD_HASH = Buffer.alloc(32, 0x33);
const AUTH_HASH = Buffer.alloc(32, 0x44);

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

describe.skipIf(!gateEnabled)('actor snapshot and decision port (real PostgreSQL)', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let db: ReturnType<typeof createIdentityPolicyDatabase>;
  let repo: IdentityPolicyRepository;
  let context: IdentityTransactionContext;
  let policyHash: Buffer;
  let humanActorRef: Awaited<ReturnType<typeof createActorSnapshot>>;
  let agentActorRef: Awaited<ReturnType<typeof createActorSnapshot>>;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `CREATE ROLE wi09_probe_ip LOGIN PASSWORD 'wi09-probe-ip' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(`GRANT identity_policy_app TO wi09_probe_ip`);
    const url = new URL(databaseUrl ?? '');
    url.username = 'wi09_probe_ip';
    url.password = 'wi09-probe-ip';
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
      allowedProjectIds: [PROJECT_A1, PROJECT_A2],
      correlationId: CORRELATION,
    };
    const deps = { db, repo, crypto, context };

    for (const [id, kind] of [
      [HUMAN, 'HUMAN'],
      [AGENT, 'AGENT'],
      [OPERATOR, 'HUMAN'],
    ] as const) {
      await withIdentityTransaction(db, context, async (trx) => {
        await repo.insertPrincipal(trx, {
          id,
          principalKind: kind,
          displayName: `WI-09 ${kind} fixture`,
          createdByPrincipalId: OPERATOR,
          createdByActorSnapshotId: OPERATOR_ACTOR,
        });
      });
    }
    const policy = await recordPolicySnapshot(deps, {
      policySnapshotId: POLICY_ID,
      policySetVersion: 'wi09-policy-set-1',
      policySchemaRefs: ['identity.PolicySnapshot@1.0'],
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      policyDocument: { rules: ['demo'], version: 1 },
      idempotencyKey: 'wi09:policy:1',
    });
    expect(policy).toMatchObject({ status: 'COMMITTED' });
    const hashRow = await admin.query<{ payload_hash: Buffer }>(
      `SELECT payload_hash FROM identity_policy.policy_snapshot WHERE policy_snapshot_id = $1`,
      [POLICY_ID],
    );
    const hash = hashRow.rows.at(0);
    if (!hash) throw new Error('policy fixture missing');
    policyHash = hash.payload_hash;

    // Project A1 capability for the human fixture only.
    const grant = await grantCapability(deps, {
      grantId: 'b8b8b8b8-b8b8-78b8-88b8-b8b8b8b8b811',
      principalId: HUMAN,
      capabilityCode: 'wi09.document.review',
      scope: { scopeKind: 'PROJECT', enterpriseId: ENTERPRISE_A, projectId: PROJECT_A1 },
      resourceSelectors: [],
      actions: ['wi09.review'],
      validFrom: new Date(),
      grantPolicySnapshotId: POLICY_ID,
      grantPolicySnapshotHash: policyHash,
      justification: 'wi09 fixture',
      idempotencyKey: 'wi09:grant:human-p1',
    });
    expect(grant).toMatchObject({ status: 'COMMITTED' });

    humanActorRef = await createActorSnapshot(deps, {
      actorSnapshotId: 'b9b9b9b9-b9b9-79b9-89b9-b9b9b9b9b911',
      principalId: HUMAN,
      declaredPrincipalKind: 'HUMAN',
      authenticationContextHash: AUTH_HASH,
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    agentActorRef = await createActorSnapshot(deps, {
      actorSnapshotId: 'b9b9b9b9-b9b9-79b9-89b9-b9b9b9b9b912',
      principalId: AGENT,
      declaredPrincipalKind: 'AGENT',
      actingForPrincipalId: HUMAN,
      actingForKind: 'HUMAN',
      authenticationContextHash: AUTH_HASH,
      enterpriseId: ENTERPRISE_A,
    });
  });

  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  const deps = () => ({ db, repo, crypto, context });

  const intentFor = (
    overrides: Partial<Parameters<typeof authorizeCommand>[1]['intent']> = {},
  ) => ({
    commandType: 'wi09.demo.command',
    commandVersion: '1.0',
    scopeKind: 'PROJECT' as const,
    enterpriseId: ENTERPRISE_A,
    projectId: PROJECT_A1,
    purpose: 'wi09.test',
    requestedCapability: 'wi09.document.review',
    commandPayloadHash: CMD_HASH,
    requestedAt: new Date(),
    highRiskAction: false,
    ...overrides,
  });

  it('rejects actor snapshot creation with a forged or incomplete shape', async () => {
    await expect(
      createActorSnapshot(deps(), {
        actorSnapshotId: 'babababa-baba-7aba-8aba-bababababa01',
        principalId: AGENT,
        declaredPrincipalKind: 'HUMAN',
        authenticationContextHash: AUTH_HASH,
        enterpriseId: ENTERPRISE_A,
      }),
    ).rejects.toMatchObject({ code: IDENTITY_ACTOR_SNAPSHOT_INVALID });

    await expect(
      createActorSnapshot(deps(), {
        actorSnapshotId: 'babababa-baba-7aba-8aba-bababababa02',
        principalId: HUMAN,
        declaredPrincipalKind: 'HUMAN',
        actingForPrincipalId: AGENT,
        authenticationContextHash: AUTH_HASH,
        enterpriseId: ENTERPRISE_A,
      }),
    ).rejects.toMatchObject({ code: IDENTITY_ACTOR_SNAPSHOT_INVALID });
  });

  it('allows Project A and denies Project B for the same human (IP-API-U-001 context)', async () => {
    const allowed = await authorizeCommand(deps(), {
      actorSnapshotRef: humanActorRef,
      intent: intentFor(),
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: {
        snapshotType: 'PolicySnapshot',
        snapshotId: POLICY_ID,
        payloadHash: policyHash,
      },
    });
    expect(allowed.outcome).toBe('ALLOW');
    expect(allowed.reasons).toContain('ALLOWED_BY_GRANT');
    expect(allowed.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const denied = await authorizeCommand(deps(), {
      actorSnapshotRef: humanActorRef,
      intent: intentFor({ projectId: PROJECT_A2, commandPayloadHash: Buffer.alloc(32, 0x55) }),
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: {
        snapshotType: 'PolicySnapshot',
        snapshotId: POLICY_ID,
        payloadHash: policyHash,
      },
    });
    expect(denied.outcome).toBe('DENY');
    expect(denied.reasons).toContain('NO_ACTIVE_GRANT');

    // Both decisions are persisted immutably with the exact bindings.
    const rows = await admin.query<{
      outcome: string;
      command_type: string;
      enterprise_id: string;
      project_id: string | null;
      principal_kind: string;
    }>(
      `SELECT outcome, command_type, enterprise_id::text, project_id::text, principal_kind
       FROM identity_policy.authorization_decision
       WHERE authorization_decision_id = ANY ($1::uuid[])`,
      [[allowed.authorizationDecisionRef.decisionId, denied.authorizationDecisionRef.decisionId]],
    );
    expect(rows.rows.map((r) => r.outcome).sort()).toEqual(['ALLOW', 'DENY']);
    expect(rows.rows.every((r) => r.principal_kind === 'HUMAN')).toBe(true);
  });

  it('keeps the agent kind on actingFor and denies human-only requests (IP-API-U-001)', async () => {
    const denied = await authorizeCommand(deps(), {
      actorSnapshotRef: agentActorRef,
      intent: intentFor({
        requestedCapability: 'release.authorize',
        scopeKind: 'ENTERPRISE',
        projectId: undefined,
        commandPayloadHash: Buffer.alloc(32, 0x66),
      }),
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: {
        snapshotType: 'PolicySnapshot',
        snapshotId: POLICY_ID,
        payloadHash: policyHash,
      },
    });
    expect(denied.outcome).toBe('DENY');
    expect(denied.reasons).toContain('CAPABILITY_HUMAN_ONLY');

    const row = await admin.query<{ principal_kind: string; acting_for_kind: string | null }>(
      `SELECT ad.principal_kind, a.acting_for_kind
       FROM identity_policy.authorization_decision ad
       JOIN identity_policy.actor_snapshot a ON a.actor_snapshot_id = ad.actor_snapshot_id
       WHERE ad.authorization_decision_id = $1`,
      [denied.authorizationDecisionRef.decisionId],
    );
    // actingFor points at the human, but the decision keeps AGENT.
    expect(row.rows[0]).toEqual({ principal_kind: 'AGENT', acting_for_kind: 'HUMAN' });

    // The same agent also cannot get the project capability via actingFor.
    const projectDenied = await authorizeCommand(deps(), {
      actorSnapshotRef: agentActorRef,
      intent: intentFor({ commandPayloadHash: Buffer.alloc(32, 0x77) }),
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: {
        snapshotType: 'PolicySnapshot',
        snapshotId: POLICY_ID,
        payloadHash: policyHash,
      },
    });
    expect(projectDenied.outcome).toBe('DENY');
    expect(projectDenied.reasons).toContain('NO_ACTIVE_GRANT');
  });

  it('rejects mismatched actor snapshot refs, auth contexts and policy refs without a decision', async () => {
    const before = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.authorization_decision`,
    );
    await expect(
      authorizeCommand(deps(), {
        actorSnapshotRef: { ...humanActorRef, payloadHash: Buffer.alloc(32, 0x00) },
        intent: intentFor(),
        authenticationContextHash: AUTH_HASH,
        policySnapshotRef: {
          snapshotType: 'PolicySnapshot',
          snapshotId: POLICY_ID,
          payloadHash: policyHash,
        },
      }),
    ).rejects.toMatchObject({ code: IDENTITY_ACTOR_SNAPSHOT_INVALID });
    await expect(
      authorizeCommand(deps(), {
        actorSnapshotRef: humanActorRef,
        intent: intentFor(),
        authenticationContextHash: Buffer.alloc(32, 0x99),
        policySnapshotRef: {
          snapshotType: 'PolicySnapshot',
          snapshotId: POLICY_ID,
          payloadHash: policyHash,
        },
      }),
    ).rejects.toBeInstanceOf(SnapshotBoundaryError);
    await expect(
      authorizeCommand(deps(), {
        actorSnapshotRef: humanActorRef,
        intent: intentFor(),
        authenticationContextHash: AUTH_HASH,
        policySnapshotRef: {
          snapshotType: 'PolicySnapshot',
          snapshotId: POLICY_ID,
          payloadHash: Buffer.alloc(32, 0x01),
        },
      }),
    ).rejects.toBeInstanceOf(SnapshotBoundaryError);
    const after = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.authorization_decision`,
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it('turns new decisions to DENY after revocation while history stays readable', async () => {
    const before = await authorizeCommand(deps(), {
      actorSnapshotRef: humanActorRef,
      intent: intentFor({ commandPayloadHash: Buffer.alloc(32, 0xa1) }),
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: {
        snapshotType: 'PolicySnapshot',
        snapshotId: POLICY_ID,
        payloadHash: policyHash,
      },
    });
    expect(before.outcome).toBe('ALLOW');

    const revoked = await revokeCapability(deps(), {
      targetId: 'b8b8b8b8-b8b8-78b8-88b8-b8b8b8b8b811',
      expectedAggregateVersion: '1',
      revokedByPrincipalId: OPERATOR,
      reasonCode: 'wi09.offboard',
      effectiveAt: new Date(),
      idempotencyKey: 'wi09:revoke-capability:1',
    });
    expect(revoked).toMatchObject({ status: 'COMMITTED' });

    const afterRevoke = await authorizeCommand(deps(), {
      actorSnapshotRef: humanActorRef,
      intent: intentFor({ commandPayloadHash: Buffer.alloc(32, 0xa2) }),
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: {
        snapshotType: 'PolicySnapshot',
        snapshotId: POLICY_ID,
        payloadHash: policyHash,
      },
    });
    expect(afterRevoke.outcome).toBe('DENY');
    expect(afterRevoke.reasons).toContain('NO_ACTIVE_GRANT');

    // The historical ALLOW is still readable by its exact ref.
    const history = await admin.query<{ outcome: string }>(
      `SELECT outcome FROM identity_policy.authorization_decision
       WHERE authorization_decision_id = $1 AND payload_hash = $2`,
      [before.authorizationDecisionRef.decisionId, before.authorizationDecisionRef.payloadHash],
    );
    expect(history.rows[0]?.outcome).toBe('ALLOW');
  });

  it('validates presented decisions against every binding (WI-09 handler contract)', async () => {
    // Fresh grant: the earlier one was revoked by the previous test.
    const granted = await grantCapability(deps(), {
      grantId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbb011',
      principalId: HUMAN,
      capabilityCode: 'wi09.validation.capability',
      scope: { scopeKind: 'PROJECT', enterpriseId: ENTERPRISE_A, projectId: PROJECT_A1 },
      resourceSelectors: [],
      actions: ['wi09.validate'],
      validFrom: new Date(),
      grantPolicySnapshotId: POLICY_ID,
      grantPolicySnapshotHash: policyHash,
      justification: 'wi09 validation fixture',
      idempotencyKey: 'wi09:grant:validation',
    });
    expect(granted).toMatchObject({ status: 'COMMITTED' });
    const decision = await authorizeCommand(deps(), {
      actorSnapshotRef: humanActorRef,
      intent: intentFor({
        commandPayloadHash: Buffer.alloc(32, 0xb1),
        requestedCapability: 'wi09.validation.capability',
      }),
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: {
        snapshotType: 'PolicySnapshot',
        snapshotId: POLICY_ID,
        payloadHash: policyHash,
      },
    });
    const base = {
      decisionRef: decision.authorizationDecisionRef,
      expectedCommandType: 'wi09.demo.command',
      expectedCommandVersion: '1.0',
      expectedScope: {
        scopeKind: 'PROJECT' as const,
        enterpriseId: ENTERPRISE_A,
        projectId: PROJECT_A1,
      },
      expectedPurpose: 'wi09.test',
      expectedCommandPayloadHash: Buffer.alloc(32, 0xb1),
      expectedAuthenticationContextHash: AUTH_HASH,
      now: new Date(),
    };
    await expect(validateAuthorizationDecision(deps(), base)).resolves.toMatchObject({
      valid: true,
      outcome: 'ALLOW',
    });
    await expect(
      validateAuthorizationDecision(deps(), {
        ...base,
        expectedCommandType: 'other.command',
      }),
    ).resolves.toMatchObject({ valid: false, reason: 'COMMAND_TYPE_MISMATCH' });
    await expect(
      validateAuthorizationDecision(deps(), { ...base, expectedPurpose: 'other.purpose' }),
    ).resolves.toMatchObject({ valid: false, reason: 'PURPOSE_MISMATCH' });
    await expect(
      validateAuthorizationDecision(deps(), {
        ...base,
        expectedScope: { scopeKind: 'PROJECT', enterpriseId: ENTERPRISE_A, projectId: PROJECT_A2 },
      }),
    ).resolves.toMatchObject({ valid: false, reason: 'SCOPE_MISMATCH' });
    await expect(
      validateAuthorizationDecision(deps(), {
        ...base,
        expectedCommandPayloadHash: Buffer.alloc(32, 0xff),
      }),
    ).resolves.toMatchObject({ valid: false, reason: 'PAYLOAD_HASH_MISMATCH' });
    await expect(
      validateAuthorizationDecision(deps(), { ...base, now: new Date(Date.now() + 3_600_000) }),
    ).resolves.toMatchObject({ valid: false, reason: 'EXPIRED' });
    await expect(
      validateAuthorizationDecision(deps(), {
        ...base,
        decisionRef: {
          decisionId: decision.authorizationDecisionRef.decisionId,
          payloadHash: Buffer.alloc(32, 0x02),
        },
      }),
    ).resolves.toMatchObject({ valid: false, reason: 'HASH_MISMATCH' });
  });

  it('serves the access queries with saved decisions (6/6 public queries reachable)', async () => {
    const policyRef = {
      snapshotType: 'PolicySnapshot' as const,
      snapshotId: POLICY_ID,
      payloadHash: policyHash,
    };
    const enterprise = await checkEnterpriseAccess(deps(), {
      principalId: HUMAN,
      scopeKind: 'ENTERPRISE',
      enterpriseId: ENTERPRISE_A,
      action: 'wi09.any.enterprise.action',
      purpose: 'wi09.check',
      asOf: new Date(),
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: policyRef,
    });
    expect(enterprise.outcome).toBe('DENY');
    expect(enterprise.authorizationDecisionRef.decisionId).toBeTruthy();

    const project = await checkProjectAccess(deps(), {
      principalId: HUMAN,
      scopeKind: 'PROJECT',
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
      action: 'wi09.document.review',
      purpose: 'wi09.check',
      asOf: new Date(),
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: policyRef,
    });
    // The wi09.document.review grant was revoked earlier: the check denies,
    // while the effective lists show only the still-active validation grant
    // from the previous test (history facts are not "effective").
    expect(project.outcome).toBe('DENY');
    expect(project.effectiveCapabilities).toEqual([
      { objectType: 'CapabilityGrant', objectId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbb011' },
    ]);

    const humanOnly = await checkHumanOnlyCapability(deps(), {
      principalId: AGENT,
      scopeKind: 'ENTERPRISE',
      enterpriseId: ENTERPRISE_A,
      capabilityCode: 'release.authorize',
      purpose: 'wi09.human-only',
      asOf: new Date(),
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: policyRef,
    });
    expect(humanOnly.outcome).toBe('DENY');
    expect(humanOnly.reasons).toContain('CAPABILITY_HUMAN_ONLY');
  });

  it('resolves policy snapshots only by exact id+hash (no latest)', async () => {
    const view = await getPolicySnapshot(deps(), {
      snapshotId: POLICY_ID,
      payloadHash: policyHash,
    });
    expect(view.policySetVersion).toBe('wi09-policy-set-1');
    expect(view.policySnapshotRef.snapshotId).toBe(POLICY_ID);

    await expect(
      getPolicySnapshot(deps(), { snapshotId: POLICY_ID, payloadHash: Buffer.alloc(32, 0x03) }),
    ).rejects.toMatchObject({ code: IDENTITY_POLICY_SNAPSHOT_HASH_MISMATCH });
    await expect(
      getPolicySnapshot(deps(), {
        snapshotId: '00000000-0000-7000-8000-0000000000ff',
        payloadHash: policyHash,
      }),
    ).rejects.toMatchObject({ code: IDENTITY_POLICY_SNAPSHOT_NOT_FOUND });
  });

  it('keeps decisions immutable for the app role', async () => {
    await admin.query(`SET ROLE identity_policy_app`);
    await expect(
      admin.query(
        `UPDATE identity_policy.authorization_decision SET outcome = 'ALLOW' WHERE outcome = 'DENY'`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      admin.query(`DELETE FROM identity_policy.authorization_decision`),
    ).rejects.toMatchObject({ code: '42501' });
    await admin.query(`RESET ROLE`);
  });
});
