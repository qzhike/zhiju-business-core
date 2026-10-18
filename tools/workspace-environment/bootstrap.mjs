import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import pg from 'pg';
import {
  IdentityPolicyRepository,
  createIdentityPolicyDatabase,
  withIdentityTransaction,
  createBootstrapClaim,
  registerPrincipal,
  linkExternalIdentity,
} from '@zhiju/identity-policy';
import { newUuidV7 } from '@zhiju/shared-kernel';

import { writePrivateJson } from './config.mjs';
import { databaseUrl, issuerFor } from './deployment.mjs';

export function identityCrypto(secrets) {
  const lookupKey = Buffer.from(secrets.lookupKey, 'hex'),
    fieldKey = Buffer.from(secrets.fieldKey, 'hex');
  return {
    lookupHash: {
      computeKeyedLookupHash: (value) => ({
        hash: createHmac('sha256', lookupKey).update(value).digest(),
        algorithm: 'HMAC-SHA-256',
        keyVersion: 1,
      }),
    },
    fieldEncryption: {
      encryptField(value) {
        const iv = randomBytes(12),
          cipher = createCipheriv('aes-256-gcm', fieldKey, iv);
        const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        return {
          ciphertext: Buffer.concat([iv, cipher.getAuthTag(), bytes]),
          algorithm: 'AES-256-GCM',
          keyVersion: 1,
        };
      },
      decryptField(field) {
        const decipher = createDecipheriv(
          'aes-256-gcm',
          fieldKey,
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
}

function committed(result) {
  if (
    result.status !== 'COMMITTED' &&
    !(result.status === 'DUPLICATE' && result.originalOutcome === 'COMMITTED')
  )
    throw new Error('ENV_B_IDENTITY_BOOTSTRAP_REJECTED');
}

export async function readIdentities(config) {
  const value = JSON.parse(await readFile(join(config.dataDir, 'identities.json'), 'utf8'));
  if (value.instanceId !== config.instanceId || value.issuer !== issuerFor(config))
    throw new Error('ENV_B_IDENTITY_BINDING_MISMATCH');
  for (const field of ['humanId', 'boardServiceId', 'linkId'])
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value[field]))
      throw new Error('ENV_B_IDENTITY_BINDING_INVALID');
  return value;
}

/** A local operator bootstrap, not a browser-created or synthetic OIDC session. */
export async function bootstrapIdentities(config, secrets) {
  let identities;
  try {
    identities = await readIdentities(config);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    identities = {
      instanceId: config.instanceId,
      issuer: issuerFor(config),
      humanId: newUuidV7(),
      boardServiceId: newUuidV7(),
      linkId: newUuidV7(),
      verifiedAt: new Date().toISOString(),
    };
    await writePrivateJson(join(config.dataDir, 'identities.json'), identities, true);
  }
  const pool = new pg.Pool({
    connectionString: databaseUrl(config, secrets.coreDatabasePassword),
    max: 2,
  });
  const db = createIdentityPolicyDatabase(pool),
    crypto = identityCrypto(secrets);
  const context = {
    kind: 'REQUEST',
    principalId: identities.humanId,
    actorSnapshotId: newUuidV7(),
    authorizationDecisionId: newUuidV7(),
    authorizationDecisionHash: createHash('sha256')
      .update(`local-environment-b:${config.instanceId}`)
      .digest(),
    authorizationDecisionExpiresAt: new Date(Date.now() + 300_000),
    enterpriseId: '00000000-0000-7000-8000-000000000000',
    allowedProjectIds: [],
    correlationId: newUuidV7(),
  };
  const deps = { db, repo: new IdentityPolicyRepository(crypto), crypto, context };
  try {
    for (const [principalId, kind] of [
      [identities.humanId, 'HUMAN'],
      [identities.boardServiceId, 'SERVICE'],
    ]) {
      const existing = await withIdentityTransaction(db, context, (trx) =>
        deps.repo.getPrincipalById(trx, principalId),
      );
      if (existing) {
        if (existing.principal_kind !== kind || existing.status !== 'ACTIVE')
          throw new Error('ENV_B_IDENTITY_STATE_MISMATCH');
        continue;
      }
      const claim =
        kind === 'HUMAN'
          ? await createBootstrapClaim(deps, {
              purpose: 'FIRST_PRINCIPAL',
              operatorDescription: 'Local Environment B operator',
              operatorActorSnapshotId: context.actorSnapshotId,
              operatorAuthorizationDecisionId: context.authorizationDecisionId,
              reason: 'Initialize the dedicated persistent macOS manual-test environment',
              evidenceRefs: { environment: 'B', instanceId: config.instanceId },
              expiresAt: context.authorizationDecisionExpiresAt,
            })
          : undefined;
      committed(
        await registerPrincipal(deps, {
          principalId,
          principalKind: kind,
          displayName: kind === 'HUMAN' ? '环境 B 测试顾问' : 'Environment B board service',
          initialStatus: 'ACTIVE',
          idempotencyKey: claim?.claimId ?? principalId,
          ...(claim ? { bootstrapClaimId: claim.claimId } : {}),
        }),
      );
    }
    // provisionRealm has already verified this user through the real admin API.
    const existingLink = await withIdentityTransaction(db, context, (trx) =>
      deps.repo.findExternalIdentityLinkByLookup(
        trx,
        'keycloak',
        identities.issuer,
        secrets.subjectId,
      ),
    );
    if (existingLink) {
      if (existingLink.principalId !== identities.humanId)
        throw new Error('ENV_B_IDENTITY_LINK_MISMATCH');
    } else
      committed(
        await linkExternalIdentity(deps, {
          principalId: identities.humanId,
          providerCode: 'keycloak',
          accountExternalId: identities.issuer,
          subjectExternalId: secrets.subjectId,
          verifiedAt: new Date(identities.verifiedAt),
          verificationMethod: 'LOCAL_KEYCLOAK_ADMIN_USER_READBACK',
          evidenceRefs: { environment: 'B', instanceId: config.instanceId },
          linkId: identities.linkId,
          idempotencyKey: identities.linkId,
        }),
      );
    return identities;
  } finally {
    await db.destroy();
  }
}
