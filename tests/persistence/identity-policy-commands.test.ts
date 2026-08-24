import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  createBootstrapClaim,
  createIdentityPolicyDatabase,
  IDENTITY_BOOTSTRAP_CLAIM_CLOSED,
  IDENTITY_BOOTSTRAP_CLAIM_CONSUMED,
  IDENTITY_BOOTSTRAP_CLAIM_EXPIRED,
  IDENTITY_EXTERNAL_LINK_CONFLICT,
  IDENTITY_EXTERNAL_IDENTITY_NOT_VERIFIED,
  IDENTITY_PRINCIPAL_INVALID_INITIAL_STATUS,
  IDENTITY_PRINCIPAL_INVALID_KIND,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  IdentityPolicyRepository,
  linkExternalIdentity,
  registerPrincipal,
  resolvePrincipal,
  type IdentityCryptoPorts,
  type IdentityTransactionContext,
  type CommandExecutionError,
} from '@zhiju/identity-policy';

// IM-02 WI-07 (issue #35): register_principal / link_external_identity /
// resolve_principal on real PostgreSQL through the runtime role, including
// the one-time audited bootstrap claim, idempotent replay, conflict
// handling and IP-API-U-002 / IP-API-C-001.

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const ENTERPRISE_A = '81818181-8181-7818-8818-8181818181a1';
const ENTERPRISE_B = '82828282-8282-7828-8828-8282828282b2';
const OPERATOR = '83838383-8383-7838-8838-8383838383c1';
const OPERATOR_ACTOR = '84848484-8484-7848-8848-8484848484d1';
const DECISION = '85858585-8585-7858-8858-8585858585e1';
const DECISION_HASH = Buffer.alloc(32, 0x71);
const CORRELATION = '86868686-8686-7868-8868-8686868686f1';

const HUMAN = '87878787-8787-7878-8878-8787878787a1';
const AGENT = '87878787-8787-7878-8878-8787878787a2';
const SERVICE = '87878787-8787-7878-8878-8787878787a3';
const RAW_ACCOUNT = 'ou_wi07-account@example.com';
const RAW_SUBJECT = 'om_wi07-subject@example.com';

function testCrypto(): IdentityCryptoPorts {
  const hmacKey = Buffer.alloc(32, 0x9c);
  const aesKey = Buffer.alloc(32, 0x7e);
  return {
    lookupHash: {
      computeKeyedLookupHash(input: string) {
        return {
          hash: createHmac('sha256', hmacKey).update(input, 'utf8').digest(),
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
        return {
          ciphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]),
          algorithm: 'AES-256-GCM' as const,
          keyVersion: 1,
        };
      },
      decryptField(field: { ciphertext: Buffer }) {
        const decipher = createDecipheriv('aes-256-gcm', aesKey, field.ciphertext.subarray(0, 12));
        decipher.setAuthTag(field.ciphertext.subarray(12, 28));
        return Buffer.concat([
          decipher.update(field.ciphertext.subarray(28)),
          decipher.final(),
        ]).toString('utf8');
      },
    },
  };
}

describe.skipIf(!gateEnabled)('identity command handlers (real PostgreSQL)', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let db: ReturnType<typeof createIdentityPolicyDatabase>;
  let repo: IdentityPolicyRepository;
  let context: IdentityTransactionContext;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `CREATE ROLE wi07_probe_ip LOGIN PASSWORD 'wi07-probe-ip' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(`GRANT platform_context_establisher, identity_policy_app TO wi07_probe_ip`);
    const url = new URL(databaseUrl ?? '');
    url.username = 'wi07_probe_ip';
    url.password = 'wi07-probe-ip';
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
    db = createIdentityPolicyDatabase(pool);
    repo = new IdentityPolicyRepository(testCrypto());
    context = {
      kind: 'REQUEST',
      principalId: OPERATOR,
      actorSnapshotId: OPERATOR_ACTOR,
      authorizationDecisionId: DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      enterpriseId: ENTERPRISE_A,
      allowedProjectIds: [],
      correlationId: CORRELATION,
    };
  });

  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  const deps = () => ({ db, repo, crypto: testCrypto(), context });

  it('registers HUMAN, AGENT and SERVICE principals with ACTIVE status', async () => {
    const claim = await createBootstrapClaim(deps(), {
      purpose: 'wi07.kinds-fixture',
      operatorDescription: 'wi07 operator fixture',
      operatorActorSnapshotId: OPERATOR_ACTOR,
      operatorAuthorizationDecisionId: DECISION,
      reason: 'wi07 fixture claim',
      evidenceRefs: { kind: 'fixture' },
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    // The one-time claim covers exactly one principal: the first (HUMAN)
    // commits, the AGENT and SERVICE attempts lose deterministically.
    const outcomes: string[] = [];
    for (const [principalId, kind] of [
      [HUMAN, 'HUMAN'],
      [AGENT, 'AGENT'],
      [SERVICE, 'SERVICE'],
    ] as const) {
      const result = await registerPrincipal(deps(), {
        principalId,
        principalKind: kind,
        displayName: `WI-07 ${kind} fixture`,
        initialStatus: 'ACTIVE',
        bootstrapClaimId: claim.claimId,
        idempotencyKey: `wi07:register:${principalId}`,
      });
      outcomes.push(`${kind}:${result.status}`);
    }
    expect(outcomes).toEqual(['HUMAN:COMMITTED', 'AGENT:REJECTED', 'SERVICE:REJECTED']);
    const human = await admin.query<{ principal_kind: string; status: string }>(
      `SELECT principal_kind, status FROM identity_policy.principal WHERE id = $1`,
      [HUMAN],
    );
    expect(human.rows[0]).toEqual({ principal_kind: 'HUMAN', status: 'ACTIVE' });
  });

  it('registers further principals without a claim once one exists', async () => {
    // The HUMAN fixture from the previous test already exists, so the
    // bootstrap claim is no longer required for later registrations.
    const result = await registerPrincipal(deps(), {
      principalId: AGENT,
      principalKind: 'AGENT',
      displayName: 'WI-07 Agent fixture',
      initialStatus: 'ACTIVE',
      idempotencyKey: 'wi07:register:agent-no-claim',
    });
    expect(result).toMatchObject({ status: 'COMMITTED' });
    const principal = await admin.query<{ principal_kind: string; status: string }>(
      `SELECT principal_kind, status FROM identity_policy.principal WHERE id = $1`,
      [AGENT],
    );
    expect(principal.rows[0]).toEqual({ principal_kind: 'AGENT', status: 'ACTIVE' });

    const serviceResult = await registerPrincipal(deps(), {
      principalId: SERVICE,
      principalKind: 'SERVICE',
      displayName: 'WI-07 Service fixture',
      initialStatus: 'ACTIVE',
      idempotencyKey: 'wi07:register:service-no-claim',
    });
    expect(serviceResult).toMatchObject({ status: 'COMMITTED' });
  });

  it('rejects an invalid initial status with a stable code', async () => {
    const result = await registerPrincipal(deps(), {
      principalId: '88888888-8888-7888-8888-888888888801',
      principalKind: 'HUMAN',
      displayName: 'Bad status fixture',
      initialStatus: 'SUSPENDED',
      idempotencyKey: 'wi07:register:bad-status',
    });
    expect(result).toMatchObject({
      status: 'REJECTED',
      errorCode: IDENTITY_PRINCIPAL_INVALID_INITIAL_STATUS,
    });
    const receipt = await admin.query<{ outcome: string }>(
      `SELECT outcome FROM identity_policy.platform_command_receipt
       WHERE idempotency_key = $1`,
      ['wi07:register:bad-status'],
    );
    expect(receipt.rows[0]?.outcome).toBe('REJECTED');
  });

  it('rejects an invalid principal kind with a stable code and receipt', async () => {
    const result = await registerPrincipal(deps(), {
      principalId: '88888888-8888-7888-8888-888888888806',
      principalKind: 'INVALID_KIND' as never,
      displayName: 'Bad kind fixture',
      initialStatus: 'ACTIVE',
      idempotencyKey: 'wi07:register:bad-kind',
    });
    expect(result).toMatchObject({
      status: 'REJECTED',
      errorCode: IDENTITY_PRINCIPAL_INVALID_KIND,
    });
    const receipt = await admin.query<{
      outcome: string;
      result_payload: { errorCode?: string } | null;
      error_code: string | null;
    }>(
      `SELECT r.outcome, r.result_payload, a.error_code
       FROM identity_policy.platform_command_receipt r
       LEFT JOIN identity_policy.platform_audit_record a ON a.command_id = r.command_id
       WHERE r.idempotency_key = $1`,
      ['wi07:register:bad-kind'],
    );
    expect(receipt.rows[0]).toMatchObject({
      outcome: 'REJECTED',
      result_payload: { errorCode: IDENTITY_PRINCIPAL_INVALID_KIND },
      error_code: IDENTITY_PRINCIPAL_INVALID_KIND,
    });
  });

  it('gates, consumes and audits the one-time bootstrap claim deterministically', async () => {
    // Expired claim: refused.
    const expired = await createBootstrapClaim(deps(), {
      purpose: 'wi07.expired-claim',
      operatorDescription: 'wi07 operator fixture',
      operatorActorSnapshotId: OPERATOR_ACTOR,
      operatorAuthorizationDecisionId: DECISION,
      reason: 'expired fixture',
      evidenceRefs: {},
      expiresAt: new Date(Date.now() - 60_000),
    });
    const expiredResult = await registerPrincipal(deps(), {
      principalId: '88888888-8888-7888-8888-888888888802',
      principalKind: 'HUMAN',
      displayName: 'Expired claim fixture',
      initialStatus: 'ACTIVE',
      bootstrapClaimId: expired.claimId,
      idempotencyKey: 'wi07:register:expired-claim',
    });
    expect(expiredResult).toMatchObject({
      status: 'REJECTED',
      errorCode: IDENTITY_BOOTSTRAP_CLAIM_EXPIRED,
    });

    // Valid claim: first registration commits and consumes it atomically.
    const valid = await createBootstrapClaim(deps(), {
      purpose: 'wi07.valid-claim',
      operatorDescription: 'wi07 operator fixture',
      operatorActorSnapshotId: OPERATOR_ACTOR,
      operatorAuthorizationDecisionId: DECISION,
      reason: 'first business principal fixture',
      evidenceRefs: { ticket: 'WI-07' },
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const first = await registerPrincipal(deps(), {
      principalId: '88888888-8888-7888-8888-888888888803',
      principalKind: 'HUMAN',
      displayName: 'Bootstrap principal fixture',
      initialStatus: 'ACTIVE',
      bootstrapClaimId: valid.claimId,
      idempotencyKey: 'wi07:register:bootstrap-first',
    });
    expect(first).toMatchObject({ status: 'COMMITTED' });
    const consumed = await admin.query<{
      consumed_at: Date | null;
      consumed_by_command_id: string | null;
    }>(
      `SELECT consumed_at, consumed_by_command_id::text FROM identity_policy.bootstrap_claim
       WHERE claim_id = $1`,
      [valid.claimId],
    );
    expect(consumed.rows[0]?.consumed_at).not.toBeNull();
    expect(consumed.rows[0]?.consumed_by_command_id).toBeTruthy();

    // Idempotent replay of the identical request: DUPLICATE, no second claim
    // consumption, no second principal.
    const replay = await registerPrincipal(deps(), {
      principalId: '88888888-8888-7888-8888-888888888803',
      principalKind: 'HUMAN',
      displayName: 'Bootstrap principal fixture',
      initialStatus: 'ACTIVE',
      bootstrapClaimId: valid.claimId,
      idempotencyKey: 'wi07:register:bootstrap-first',
    });
    expect(replay).toMatchObject({ status: 'DUPLICATE', originalOutcome: 'COMMITTED' });

    // A different subject trying the same claim loses deterministically.
    const contention = await registerPrincipal(deps(), {
      principalId: '88888888-8888-7888-8888-888888888804',
      principalKind: 'HUMAN',
      displayName: 'Contention fixture',
      initialStatus: 'ACTIVE',
      bootstrapClaimId: valid.claimId,
      idempotencyKey: 'wi07:register:bootstrap-contention',
    });
    expect(contention).toMatchObject({
      status: 'REJECTED',
      errorCode: IDENTITY_BOOTSTRAP_CLAIM_CONSUMED,
    });

    // Concurrent claim consumers must have exactly one winner. The row lock
    // is the database-level adjudicator; both commands still finish with a
    // durable receipt instead of one overwriting the claim.
    const concurrentClaim = await createBootstrapClaim(deps(), {
      purpose: 'wi07.concurrent-claim',
      operatorDescription: 'wi07 concurrent operator fixture',
      operatorActorSnapshotId: OPERATOR_ACTOR,
      operatorAuthorizationDecisionId: DECISION,
      reason: 'concurrent claim fixture',
      evidenceRefs: {},
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const concurrentResults = await Promise.all([
      registerPrincipal(deps(), {
        principalId: '88888888-8888-7888-8888-888888888807',
        principalKind: 'HUMAN',
        displayName: 'Concurrent winner A',
        initialStatus: 'ACTIVE',
        bootstrapClaimId: concurrentClaim.claimId,
        idempotencyKey: 'wi07:register:concurrent-a',
      }),
      registerPrincipal(deps(), {
        principalId: '88888888-8888-7888-8888-888888888808',
        principalKind: 'AGENT',
        displayName: 'Concurrent loser B',
        initialStatus: 'ACTIVE',
        bootstrapClaimId: concurrentClaim.claimId,
        idempotencyKey: 'wi07:register:concurrent-b',
      }),
    ]);
    expect(concurrentResults.map((result) => result.status).sort()).toEqual([
      'COMMITTED',
      'REJECTED',
    ]);
    expect(concurrentResults.find((result) => result.status === 'REJECTED')).toMatchObject({
      errorCode: IDENTITY_BOOTSTRAP_CLAIM_CONSUMED,
    });

    // A permanently closed claim can never be used again (closed by WI-08
    // in production; here closed directly to pin the behavior).
    const closed = await createBootstrapClaim(deps(), {
      purpose: 'wi07.closed-claim',
      operatorDescription: 'wi07 operator fixture',
      operatorActorSnapshotId: OPERATOR_ACTOR,
      operatorAuthorizationDecisionId: DECISION,
      reason: 'closed fixture',
      evidenceRefs: {},
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await admin.query(
      `UPDATE identity_policy.bootstrap_claim
       SET closed_at = now(), closed_reason = 'wi07 fixture close'
       WHERE claim_id = $1`,
      [closed.claimId],
    );
    const closedResult = await registerPrincipal(deps(), {
      principalId: '88888888-8888-7888-8888-888888888805',
      principalKind: 'HUMAN',
      displayName: 'Closed claim fixture',
      initialStatus: 'ACTIVE',
      bootstrapClaimId: closed.claimId,
      idempotencyKey: 'wi07:register:closed-claim',
    });
    expect(closedResult).toMatchObject({
      status: 'REJECTED',
      errorCode: IDENTITY_BOOTSTRAP_CLAIM_CLOSED,
    });

    // The claim lifecycle itself is audited through the receipt+audit trail.
    const audits = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.platform_audit_record
       WHERE command_type = 'identity.register_principal'`,
    );
    expect(Number(audits.rows[0]?.count)).toBeGreaterThanOrEqual(3);
  });

  it('links external identities, resolves them back and keeps raw values invisible (IP-API-C-001)', async () => {
    // A replay must send the identical request: verifiedAt is part of the
    // canonical request payload, so the fixture pins it.
    const verifiedAt = new Date(Date.now() - 60_000);
    const linked = await linkExternalIdentity(deps(), {
      principalId: HUMAN,
      providerCode: 'FEISHU',
      accountExternalId: RAW_ACCOUNT,
      subjectExternalId: RAW_SUBJECT,
      verifiedAt,
      verificationMethod: 'wi07.manual-check',
      evidenceRefs: { ticket: 'WI-07' },
      displayHint: 'feishu user (redacted)',
      idempotencyKey: 'wi07:link:human-feishu',
    });
    expect(linked).toMatchObject({ status: 'COMMITTED' });

    // Replay is idempotent.
    const replay = await linkExternalIdentity(deps(), {
      principalId: HUMAN,
      providerCode: 'FEISHU',
      accountExternalId: RAW_ACCOUNT,
      subjectExternalId: RAW_SUBJECT,
      verifiedAt,
      verificationMethod: 'wi07.manual-check',
      evidenceRefs: { ticket: 'WI-07' },
      displayHint: 'feishu user (redacted)',
      idempotencyKey: 'wi07:link:human-feishu',
    });
    expect(replay).toMatchObject({ status: 'DUPLICATE', originalOutcome: 'COMMITTED' });

    // The subject participates in the idempotency request hash. Reusing the
    // same key for a different subject is a payload conflict, not a duplicate.
    await expect(
      linkExternalIdentity(deps(), {
        principalId: HUMAN,
        providerCode: 'FEISHU',
        accountExternalId: RAW_ACCOUNT,
        subjectExternalId: 'om_wi07-different-subject@example.com',
        verifiedAt,
        verificationMethod: 'wi07.manual-check',
        evidenceRefs: { ticket: 'WI-07' },
        idempotencyKey: 'wi07:link:human-feishu',
      }),
    ).rejects.toMatchObject({
      code: IDEMPOTENCY_PAYLOAD_CONFLICT,
    } satisfies Partial<CommandExecutionError>);

    const resolved = await resolvePrincipal(deps(), {
      lookup: {
        kind: 'EXTERNAL_IDENTITY',
        identityKey: {
          providerCode: 'feishu',
          accountExternalId: RAW_ACCOUNT,
          subjectExternalId: RAW_SUBJECT,
        },
      },
      purpose: 'wi07.resolve',
    });
    expect(resolved).toMatchObject({
      principalRef: {
        kind: 'OBJECT',
        objectType: 'identity.principal',
        objectId: HUMAN,
        scope: { enterpriseId: ENTERPRISE_A },
      },
      principalKind: 'HUMAN',
      status: 'ACTIVE',
      displayName: {
        presence: 'PRESENT',
        value: 'WI-07 HUMAN fixture',
        evidenceRefs: [],
      },
      resolvedByLinkRef: {
        kind: 'OBJECT',
        objectType: 'identity.external_identity_link',
        scope: { enterpriseId: ENTERPRISE_A },
      },
    });

    // Scope-folded lookup: another enterprise context must not resolve.
    const foldedContext = { ...context, enterpriseId: ENTERPRISE_B };
    const folded = await resolvePrincipal(
      { db, repo, crypto: testCrypto(), context: foldedContext },
      {
        lookup: {
          kind: 'EXTERNAL_IDENTITY',
          identityKey: {
            providerCode: 'feishu',
            accountExternalId: RAW_ACCOUNT,
            subjectExternalId: RAW_SUBJECT,
          },
        },
        requiredScopeRef: { enterpriseId: ENTERPRISE_A },
        purpose: 'wi07.cross-scope-probe',
      },
    );
    expect(folded).toBeUndefined();

    // Unknown external identity does not reveal anything.
    const unknown = await resolvePrincipal(deps(), {
      lookup: {
        kind: 'EXTERNAL_IDENTITY',
        identityKey: {
          providerCode: 'feishu',
          accountExternalId: 'ou_unknown@example.com',
          subjectExternalId: 'om_unknown@example.com',
        },
      },
      purpose: 'wi07.unknown',
    });
    expect(unknown).toBeUndefined();

    // IP-API-C-001: events, audit and errors never carry the raw values.
    const events = await admin.query<{ payload: unknown }>(
      `SELECT payload FROM identity_policy.platform_outbox_event
       WHERE event_type = 'identity.ExternalIdentityLinked'`,
    );
    expect(events.rows.length).toBeGreaterThanOrEqual(1);
    const serialized = JSON.stringify(events.rows);
    expect(serialized).not.toContain(RAW_ACCOUNT);
    expect(serialized).not.toContain(RAW_SUBJECT);
    expect(serialized).not.toContain('example.com');
    expect(serialized).toContain('externalIdentityLookupHashRef');
  });

  it('keeps the first mapping on external identity conflicts (IP-API-U-002)', async () => {
    const conflict = await linkExternalIdentity(deps(), {
      principalId: SERVICE,
      providerCode: 'feishu',
      accountExternalId: RAW_ACCOUNT,
      subjectExternalId: RAW_SUBJECT,
      verifiedAt: new Date(),
      verificationMethod: 'wi07.conflict-attempt',
      evidenceRefs: {},
      idempotencyKey: 'wi07:link:conflict',
    });
    expect(conflict).toMatchObject({
      status: 'REJECTED',
      errorCode: IDENTITY_EXTERNAL_LINK_CONFLICT,
    });
    expect((conflict as { safeSummary?: string }).safeSummary).not.toContain(RAW_ACCOUNT);

    const stillHuman = await resolvePrincipal(deps(), {
      lookup: {
        kind: 'EXTERNAL_IDENTITY',
        identityKey: {
          providerCode: 'feishu',
          accountExternalId: RAW_ACCOUNT,
          subjectExternalId: RAW_SUBJECT,
        },
      },
      purpose: 'wi07.post-conflict',
    });
    expect(stillHuman?.principalRef.objectId).toBe(HUMAN);
  });

  it('adjudicates concurrent external identity conflicts inside live transactions', async () => {
    const concurrentInputs = [
      {
        principalId: AGENT,
        idempotencyKey: 'wi07:link:concurrent-agent',
      },
      {
        principalId: SERVICE,
        idempotencyKey: 'wi07:link:concurrent-service',
      },
    ] as const;
    const outcomes = await Promise.allSettled(
      concurrentInputs.map(({ principalId, idempotencyKey }) =>
        linkExternalIdentity(deps(), {
          principalId,
          providerCode: 'FEISHU',
          accountExternalId: 'ou_wi07-concurrent@example.com',
          subjectExternalId: 'om_wi07-concurrent@example.com',
          verifiedAt: new Date(Date.now() - 60_000),
          verificationMethod: 'wi07.concurrent-check',
          evidenceRefs: { ticket: 'WI-07' },
          idempotencyKey,
        }),
      ),
    );
    expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true);
    const results = outcomes.map((outcome) =>
      outcome.status === 'fulfilled' ? outcome.value : undefined,
    );
    expect(results.map((result) => result?.status).sort()).toEqual(['COMMITTED', 'REJECTED']);
    expect(results.find((result) => result?.status === 'REJECTED')).toMatchObject({
      errorCode: IDENTITY_EXTERNAL_LINK_CONFLICT,
    });
  });

  it('rejects unverified external identities', async () => {
    const result = await linkExternalIdentity(deps(), {
      principalId: HUMAN,
      providerCode: 'feishu',
      accountExternalId: 'ou_unverified@example.com',
      subjectExternalId: 'om_unverified@example.com',
      verifiedAt: new Date(),
      verificationMethod: '  ',
      evidenceRefs: {},
      idempotencyKey: 'wi07:link:unverified',
    });
    expect(result).toMatchObject({
      status: 'REJECTED',
      errorCode: IDENTITY_EXTERNAL_IDENTITY_NOT_VERIFIED,
    });
    const receipt = await admin.query<{
      outcome: string;
      result_payload: { errorCode?: string } | null;
      error_code: string | null;
    }>(
      `SELECT r.outcome, r.result_payload, a.error_code
       FROM identity_policy.platform_command_receipt r
       LEFT JOIN identity_policy.platform_audit_record a ON a.command_id = r.command_id
       WHERE r.idempotency_key = $1`,
      ['wi07:link:unverified'],
    );
    expect(receipt.rows[0]).toMatchObject({
      outcome: 'REJECTED',
      result_payload: { errorCode: IDENTITY_EXTERNAL_IDENTITY_NOT_VERIFIED },
      error_code: IDENTITY_EXTERNAL_IDENTITY_NOT_VERIFIED,
    });
  });
});
