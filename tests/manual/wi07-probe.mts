// IM-02 WI-07 (issue #35) manual acceptance probe: register masked
// Human/Agent/Service fixtures, link one test external identity, resolve it
// back to the Human, and inspect the safe event/audit trail. Disposable
// local gate container only (runbook: runbook-wi-07.md).

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import pg from 'pg';
import {
  createBootstrapClaim,
  createIdentityPolicyDatabase,
  IdentityPolicyRepository,
  linkExternalIdentity,
  registerPrincipal,
  resolvePrincipal,
  type IdentityCryptoPorts,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';

const databaseUrl = process.env.ZJU_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('ZJU_DATABASE_URL is required (disposable local container only)');
}

const ENTERPRISE = '81818181-8181-7818-8818-8181818181a1';
const OPERATOR = '83838383-8383-7838-8838-8383838383c1';
const OPERATOR_ACTOR = '84848484-8484-7848-8848-8484848484d1';
const DECISION = '85858585-8585-7858-8858-8585858585e1';
const DECISION_HASH = Buffer.alloc(32, 0x71);
const CORRELATION = '86868686-8686-7868-8868-8686868686f1';
const RAW_ACCOUNT = 'ou_wi07-manual@example.com';
const RAW_SUBJECT = 'om_wi07-manual@example.com';

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
    encryptField(plainText: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', Buffer.alloc(32, 0x7e), iv);
      const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
      return {
        ciphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]),
        algorithm: 'AES-256-GCM' as const,
        keyVersion: 1,
      };
    },
    decryptField(field: { ciphertext: Buffer }) {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        Buffer.alloc(32, 0x7e),
        field.ciphertext.subarray(0, 12),
      );
      decipher.setAuthTag(field.ciphertext.subarray(12, 28));
      return Buffer.concat([
        decipher.update(field.ciphertext.subarray(28)),
        decipher.final(),
      ]).toString('utf8');
    },
  },
};

const context: IdentityTransactionContext = {
  kind: 'REQUEST',
  principalId: OPERATOR,
  actorSnapshotId: OPERATOR_ACTOR,
  authorizationDecisionId: DECISION,
  authorizationDecisionHash: DECISION_HASH,
  authorizationDecisionExpiresAt: new Date(Date.now() + 3_600_000),
  enterpriseId: ENTERPRISE,
  allowedProjectIds: [],
  correlationId: CORRELATION,
};

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const db = createIdentityPolicyDatabase(pool);
const deps = { db, repo: new IdentityPolicyRepository(crypto), crypto, context };

const id = (n: number) => `89898989-8989-7898-8898-8989898989${String(n).padStart(2, '0')}`;

try {
  const claim = await createBootstrapClaim(deps, {
    purpose: 'wi07.manual-probe',
    operatorDescription: 'wi07 manual operator',
    operatorActorSnapshotId: OPERATOR_ACTOR,
    operatorAuthorizationDecisionId: DECISION,
    reason: 'manual acceptance probe',
    evidenceRefs: { ticket: 'WI-07' },
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  for (const [principalId, kind] of [
    [id(1), 'HUMAN'],
    [id(2), 'AGENT'],
    [id(3), 'SERVICE'],
  ] as const) {
    const result = await registerPrincipal(deps, {
      principalId,
      principalKind: kind,
      displayName: `WI-07 manual ${kind}`,
      initialStatus: 'ACTIVE',
      idempotencyKey: `wi07-manual:${principalId}`,
      ...(principalId === id(1) ? { bootstrapClaimId: claim.claimId } : {}),
    });
    console.log(`[register ${kind}]`, result.status);
  }

  const linked = await linkExternalIdentity(deps, {
    principalId: id(1),
    providerCode: 'FEISHU',
    accountExternalId: RAW_ACCOUNT,
    subjectExternalId: RAW_SUBJECT,
    verifiedAt: new Date(Date.now() - 60_000),
    verificationMethod: 'wi07.manual-check',
    evidenceRefs: { ticket: 'WI-07' },
    displayHint: 'feishu user (redacted)',
    idempotencyKey: 'wi07-manual:link',
  });
  console.log('[link]', linked.status);

  const resolved = await resolvePrincipal(deps, {
    lookup: {
      kind: 'EXTERNAL_IDENTITY',
      identityKey: {
        providerCode: 'feishu',
        accountExternalId: RAW_ACCOUNT,
        subjectExternalId: RAW_SUBJECT,
      },
    },
    purpose: 'wi07.manual.resolve',
  });
  console.log('[resolve]', resolved?.principalRef, resolved?.resolvedByLinkRef?.objectType);

  const events = await pool.query(
    `SELECT payload FROM identity_policy.platform_outbox_event
     WHERE event_type IN ('identity.PrincipalRegistered', 'identity.ExternalIdentityLinked')
     AND created_by_principal_id = $1`,
    [OPERATOR],
  );
  const serialized = JSON.stringify(events.rows);
  console.log('[events] count:', events.rows.length);
  console.log(
    '[events] raw identifiers leaked:',
    serialized.includes(RAW_ACCOUNT) || serialized.includes(RAW_SUBJECT),
  );
} finally {
  await pool.end();
}
