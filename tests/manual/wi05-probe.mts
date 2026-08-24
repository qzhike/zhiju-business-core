// IM-02 WI-05 (issue #33) manual acceptance probe. Run against a disposable
// local gate container (see .vibe/im-02-workitem-issues/runbook-wi-05.md):
//
//   ZJU_DATABASE_URL=postgres://postgres:zhiju-gate-test@127.0.0.1:PORT/zhiju_core \
//     node --experimental-strip-types tests/manual/wi05-probe.mts
//
// The script registers a masked fixture principal + encrypted external
// identity link and proves that raw identifiers appear nowhere: not in the
// returned safe view, not in any database column, not in the captured
// process output. It uses the TEST crypto implementation only — real OpenBao
// stays NOT RUN.

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import pg from 'pg';
import {
  createIdentityPolicyDatabase,
  withIdentityTransaction,
  IdentityPolicyRepository,
} from '@zhiju/identity-policy';

const databaseUrl = process.env.ZJU_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('ZJU_DATABASE_URL is required (disposable local container only)');
}

// Raw identifiers a redacted probe must never reveal.
const RAW_ACCOUNT = 'ou_wi05-manual-probe@example.com';
const RAW_SUBJECT = 'om_wi05-manual-subject@example.com';

const ENTERPRISE = '12121212-1212-7121-8121-1212121212a1';
const OPERATOR = '45454545-4545-7545-8545-4545454545e1';
const OPERATOR_ACTOR = '56565656-5656-7565-8565-5656565656f1';
const PRINCIPAL = 'a7a7a7a7-0000-7000-8000-000000000001';
const DECISION = '67676767-6767-7767-8767-6767676767a1';
const DECISION_HASH = Buffer.alloc(32, 0x5a);
const CORRELATION = '78787878-7878-7878-8878-7878787878b1';

const capturedOutput: string[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: Uint8Array | string) => {
  capturedOutput.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
  return originalWrite(chunk);
}) as typeof process.stdout.write;

const hmacKey = Buffer.alloc(32, 0x9c);
const aesKey = Buffer.alloc(32, 0x7e);
const repo = new IdentityPolicyRepository({
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
});

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const db = createIdentityPolicyDatabase(pool);

try {
  await withIdentityTransaction(
    db,
    {
      kind: 'REQUEST',
      principalId: OPERATOR,
      actorSnapshotId: OPERATOR_ACTOR,
      authorizationDecisionId: DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(Date.now() + 3_600_000),
      enterpriseId: ENTERPRISE,
      allowedProjectIds: [],
      correlationId: CORRELATION,
    },
    async (trx) => {
      await repo.insertPrincipal(trx, {
        id: PRINCIPAL,
        principalKind: 'HUMAN',
        displayName: 'WI-05 Manual Fixture (masked)',
        createdByPrincipalId: OPERATOR,
        createdByActorSnapshotId: OPERATOR_ACTOR,
      });
      await repo.insertExternalIdentityLink(trx, {
        id: 'a7a7a7a7-0000-7000-8000-000000000002',
        providerCode: 'FEISHU',
        accountExternalId: RAW_ACCOUNT,
        subjectExternalId: RAW_SUBJECT,
        displayHint: 'feishu user (redacted)',
        principalId: PRINCIPAL,
        verifiedAt: new Date(),
        verificationMethod: 'wi05.manual-probe',
        evidenceRefs: { kind: 'manual-probe' },
        createdByPrincipalId: OPERATOR,
        createdByActorSnapshotId: OPERATOR_ACTOR,
      });
    },
  );

  const link = await withIdentityTransaction(
    db,
    {
      kind: 'REQUEST',
      principalId: OPERATOR,
      actorSnapshotId: OPERATOR_ACTOR,
      authorizationDecisionId: DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(Date.now() + 3_600_000),
      enterpriseId: ENTERPRISE,
      allowedProjectIds: [],
      correlationId: CORRELATION,
    },
    (trx) => repo.findExternalIdentityLinkByLookup(trx, 'feishu', RAW_ACCOUNT, RAW_SUBJECT),
  );

  console.log('[resolve] safe view:');
  console.log({
    provider: link?.providerCode,
    accountLookupHashPrefix: link?.accountLookupHash.subarray(0, 8).toString('hex'),
    lookupHashAlgorithm: link?.lookupHashAlgorithm,
    lookupKeyVersion: link?.lookupKeyVersion,
    accountCiphertextKeyVersion: link?.accountCiphertextKeyVersion,
    encryptionAlgorithm: link?.encryptionAlgorithm,
    displayHint: link?.displayHint,
    principalId: link?.principalId,
    status: link?.status,
  });

  const scan = await pool.query<{ row: string }>(
    `SELECT t::text AS row FROM identity_policy.external_identity_link t WHERE principal_id = $1`,
    [PRINCIPAL],
  );
  const serialized = JSON.stringify(scan.rows);
  console.log('[databaseScan] raw account found:', serialized.includes(RAW_ACCOUNT));
  console.log('[databaseScan] raw subject found:', serialized.includes(RAW_SUBJECT));
  console.log('[databaseScan] email domain found:', serialized.includes('example.com'));

  await pool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid()`,
  );
  const output = capturedOutput.join('');
  console.log(
    '[logScan] raw values printed to stdout:',
    output.includes(RAW_ACCOUNT) || output.includes(RAW_SUBJECT),
  );
} finally {
  await pool.end();
}
